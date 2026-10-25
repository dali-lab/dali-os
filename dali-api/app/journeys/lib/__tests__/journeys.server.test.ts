import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  onboardingJourney: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  onboardingJourneyProgress: { upsert: vi.fn(), deleteMany: vi.fn() },
  onboardingJourneyCollaborator: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  domainLeadAssignment: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  projectAssignment: { findMany: vi.fn() },
  domainEligibility: { findMany: vi.fn() },
  user: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const roles = vi.hoisted(() => ({ getUserRoles: vi.fn() }));
const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));

vi.mock("~/lib/db", async () => {
  const { Prisma } = await import("~/lib/__mocks__/db");
  return { prisma: db, Prisma };
});
vi.mock("~/lib/roles", () => roles);
vi.mock("~/lib/feature-flags.server", () => flags);
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => null) }));

import {
  addCollaborator,
  canCreateIn,
  completeSteps,
  createJourney,
  deleteJourney,
  discardDraft,
  editDraft,
  isLastOwner,
  loadJourneyTabs,
  publishJourney,
  removeCollaborator,
  resolveJourneyViewer,
  roleOn,
  saveDraft,
  setCollaboratorRole,
  type JourneyViewer,
} from "../journeys.server";
import { createJourneyContent, createLab } from "../journey-edit";
import type { JourneyContent } from "../types";
import { diamond, mod } from "./fixtures";

const member: JourneyViewer = { id: "me", isCore: false, leadDomainIds: [] };
const core: JourneyViewer = { id: "core", isCore: true, leadDomainIds: [] };
const lead: JourneyViewer = { id: "lead", isCore: false, leadDomainIds: ["dom-1"] };
const V1 = "2026-10-01T00:00:00.000Z";
const V2 = "2026-10-02T00:00:00.000Z";

function row(collaborators: { userId: string; role: "Owner" | "Editor" }[], extra: Record<string, unknown> = {}) {
  const { id: _id, ...draft } = diamond();
  return { id: "j1", domainId: "dom-1", draft, published: null, updatedAt: new Date(V1), collaborators, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.onboardingJourney.findUniqueOrThrow.mockResolvedValue({ updatedAt: new Date(V2) });
});

describe("who can do what", () => {
  it("lets Core create anywhere and leads only in their domains", () => {
    expect(canCreateIn(core, "x")).toBe(true);
    expect(canCreateIn(lead, "dom-1")).toBe(true);
    expect(canCreateIn(lead, "dom-2")).toBe(false);
    expect(canCreateIn(member, "dom-1")).toBe(false);
  });

  it("uses the collaborator role, and treats Core as owner of everything", () => {
    expect(roleOn(member, [{ userId: "me", role: "Editor" }])).toBe("editor");
    expect(roleOn(member, [{ userId: "x", role: "Owner" }])).toBeNull();
    expect(roleOn(core, [])).toBe("owner");
    expect(roleOn(core, [{ userId: "core", role: "Editor" }])).toBe("editor");
  });

  it("finds the last owner", () => {
    expect(isLastOwner([{ userId: "a", role: "Owner" }, { userId: "b", role: "Editor" }], "a")).toBe(true);
    expect(isLastOwner([{ userId: "a", role: "Owner" }, { userId: "b", role: "Owner" }], "a")).toBe(false);
    expect(isLastOwner([{ userId: "a", role: "Owner" }], "b")).toBe(false);
  });
});

describe("resolveJourneyViewer", () => {
  it("is null for non-members and when the flag is off", async () => {
    roles.getUserRoles.mockResolvedValue({ isLabMember: false });
    expect(await resolveJourneyViewer("u")).toBeNull();
    roles.getUserRoles.mockResolvedValue({ isLabMember: true, isCore: false, isDomainLead: false });
    flags.isFeatureEnabled.mockResolvedValue(false);
    expect(await resolveJourneyViewer("u")).toBeNull();
  });

  it("collects the domains a lead leads", async () => {
    roles.getUserRoles.mockResolvedValue({ isLabMember: true, isCore: false, isDomainLead: true });
    flags.isFeatureEnabled.mockResolvedValue(true);
    db.domainLeadAssignment.findMany.mockResolvedValue([{ domainId: "d1" }, { domainId: "d2" }]);
    expect(await resolveJourneyViewer("u")).toEqual({ id: "u", isCore: false, leadDomainIds: ["d1", "d2"] });
  });
});

describe("creating and saving", () => {
  it("refuses to create outside the viewer's domains", async () => {
    expect(await createJourney(member, "dom-1")).toMatchObject({ ok: false, status: 403 });
    expect(db.onboardingJourney.create).not.toHaveBeenCalled();
  });

  it("creates a draft owned by its creator", async () => {
    db.onboardingJourney.create.mockResolvedValue({ id: "new" });
    expect(await createJourney(lead, "dom-1")).toEqual({ ok: true, id: "new" });
    const data = db.onboardingJourney.create.mock.calls[0][0].data;
    expect(data.collaborators).toEqual({ create: { userId: "lead", role: "Owner" } });
    expect(data.draft.modules[0].title).toBe("Welcome");
  });

  it("saves only against the version it was based on", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }]));
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 1 });
    expect(await saveDraft(member, "j1", createJourneyContent(), V1)).toEqual({ ok: true, version: V2 });
    expect(db.onboardingJourney.updateMany.mock.calls[0][0].where).toEqual({ id: "j1", updatedAt: new Date(V1) });
  });

  it("reports a conflict when someone saved in between", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }]));
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 0 });
    expect(await saveDraft(member, "j1", createJourneyContent(), V1)).toMatchObject({ ok: false, status: 409 });
  });

  it("hides journeys from people who can't edit them", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "x", role: "Owner" }]));
    expect(await saveDraft(member, "j1", createJourneyContent(), V1)).toMatchObject({ ok: false, status: 404 });
    expect(db.onboardingJourney.updateMany).not.toHaveBeenCalled();
  });

  it("drops undefined fields before writing JSON", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 1 });
    const content = { ...createJourneyContent(), recommended: undefined };
    await saveDraft(member, "j1", content, V1);
    expect("recommended" in db.onboardingJourney.updateMany.mock.calls[0][0].data.draft).toBe(false);
  });
});

describe("publishing", () => {
  it("refuses drafts with issues", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    const bad: JourneyContent = { title: "", description: "", modules: [] };
    expect(await publishJourney(member, "j1", bad, V1)).toMatchObject({ ok: false, status: 400 });
  });

  it("writes the draft and the live copy together under the version check", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }]));
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 1 });
    const draft = createJourneyContent();
    expect(await publishJourney(member, "j1", draft, V1)).toEqual({ ok: true, version: V2 });
    const { where, data } = db.onboardingJourney.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "j1", updatedAt: new Date(V1) });
    expect(data.draft).toEqual(data.published);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });
});

describe("discarding and deleting", () => {
  it("resets a published journey's draft to what's live", async () => {
    const published = { title: "Live", description: "", modules: [mod("a")] };
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }], { published }));
    db.onboardingJourney.update.mockResolvedValue({ updatedAt: new Date(V2) });
    expect(await discardDraft(member, "j1")).toEqual({ ok: true, deleted: false, version: V2 });
    expect(db.onboardingJourney.update.mock.calls[0][0].data).toEqual({ draft: published });
  });

  it("deletes a never-published journey, owners only", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }]));
    expect(await discardDraft(member, "j1")).toMatchObject({ ok: false, status: 403 });
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    expect(await discardDraft(member, "j1")).toEqual({ ok: true, deleted: true });
    expect(db.onboardingJourney.delete).toHaveBeenCalledWith({ where: { id: "j1" } });
  });

  it("only lets owners delete", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Editor" }]));
    expect(await deleteJourney(member, "j1")).toMatchObject({ ok: false, status: 403 });
    expect(await deleteJourney(core, "j1")).toEqual({ ok: true });
  });
});

describe("editDraft", () => {
  it("applies the edit to the latest draft and saves it", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 1 });
    const result = await editDraft(member, "j1", (d) => ({ ...d, title: "Renamed" }));
    expect(result).toMatchObject({ ok: true, version: V2, draft: { id: "j1", title: "Renamed" } });
  });

  it("retries once when someone saved in between, then gives up", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    db.onboardingJourney.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    expect(await editDraft(member, "j1", (d) => d)).toMatchObject({ ok: true });
    db.onboardingJourney.updateMany.mockResolvedValue({ count: 0 });
    expect(await editDraft(member, "j1", (d) => d)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses an edit that breaks the content shape", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(row([{ userId: "me", role: "Owner" }]));
    expect(await editDraft(member, "j1", (d) => ({ ...d, modules: [mod("a"), mod("a")] }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("completeSteps", () => {
  const withLab = { title: "J", description: "", modules: [mod("a", [], { lab: createLab() }), mod("b", ["a"])] };
  const progressRow = (completed: string[] | null) => ({
    published: withLab,
    progress: completed ? [{ completed }] : [],
  });

  it("records a lab and then its module in one request", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(progressRow(null));
    expect(await completeSteps(member, "j1", ["a#lab", "a"])).toEqual({ ok: true, completed: ["a#lab", "a"] });
    expect(db.onboardingJourneyProgress.upsert).toHaveBeenCalledOnce();
  });

  it("won't finish a module before its lab", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(progressRow([]));
    expect(await completeSteps(member, "j1", ["a"])).toMatchObject({ ok: false, error: "Finish the lab first." });
  });

  it("won't record a locked module or an unknown key", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(progressRow([]));
    expect(await completeSteps(member, "j1", ["b"])).toMatchObject({ ok: false, status: 400 });
    expect(await completeSteps(member, "j1", ["a#quiz"])).toMatchObject({ ok: false, status: 400 });
    expect(db.onboardingJourneyProgress.upsert).not.toHaveBeenCalled();
  });

  it("doesn't write again when nothing changed", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(progressRow(["a#lab"]));
    expect(await completeSteps(member, "j1", ["a#lab"])).toEqual({ ok: true, completed: ["a#lab"] });
    expect(db.onboardingJourneyProgress.upsert).not.toHaveBeenCalled();
  });

  it("only works on published journeys", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue({ published: null, progress: [] });
    expect(await completeSteps(member, "j1", ["a"])).toMatchObject({ ok: false, status: 404 });
  });
});

describe("access", () => {
  const owners = (...ids: string[]) => ids.map((userId) => ({ userId, role: "Owner" as const }));

  it("only lets owners and Core change access", async () => {
    db.onboardingJourneyCollaborator.findMany.mockResolvedValue([{ userId: "me", role: "Editor" }]);
    expect(await addCollaborator(member, "j1", "u2", "editor")).toMatchObject({ ok: false, status: 403 });
    expect(await addCollaborator(core, "j1", "me", "editor")).toEqual({ ok: true });
  });

  it("only adds current lab members", async () => {
    db.onboardingJourneyCollaborator.findMany.mockResolvedValue(owners("me"));
    db.user.findFirst.mockResolvedValue(null);
    expect(await addCollaborator(member, "j1", "alum", "editor")).toMatchObject({ ok: false, status: 400 });
    db.user.findFirst.mockResolvedValue({ id: "u2" });
    expect(await addCollaborator(member, "j1", "u2", "owner")).toEqual({ ok: true });
    expect(db.onboardingJourneyCollaborator.create).toHaveBeenCalledWith({ data: { journeyId: "j1", userId: "u2", role: "Owner" } });
  });

  it("keeps at least one owner", async () => {
    db.onboardingJourneyCollaborator.findMany.mockResolvedValue(owners("me"));
    expect(await setCollaboratorRole(member, "j1", "me", "editor")).toMatchObject({ ok: false, status: 400 });
    expect(await removeCollaborator(member, "j1", "me")).toMatchObject({ ok: false, status: 400 });
    db.onboardingJourneyCollaborator.findMany.mockResolvedValue(owners("me", "u2"));
    expect(await removeCollaborator(member, "j1", "me")).toEqual({ ok: true });
  });
});

describe("loadJourneyTabs", () => {
  beforeEach(() => {
    db.projectAssignment.findMany.mockResolvedValue([]);
    db.domainEligibility.findMany.mockResolvedValue([]);
  });

  it("includes intern program domains", async () => {
    const early = { id: "dom-eb", code: "EarlyBuilders", displayName: "Early builders" };
    db.domain.findMany.mockResolvedValue([early]);
    db.onboardingJourney.findMany.mockResolvedValue([{ domainId: "dom-eb" }]);
    expect(await loadJourneyTabs(member)).toEqual({ tabs: [early], defaultDomain: early });
    expect(db.domain.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, isSystem: false } }));
  });

  it("shows a member only domains with journeys they can see or that they belong to", async () => {
    const a = { id: "dom-a", code: "a", displayName: "A" };
    const b = { id: "dom-b", code: "b", displayName: "B" };
    const c = { id: "dom-c", code: "c", displayName: "C" };
    db.domain.findMany.mockResolvedValue([a, b, c]);
    db.onboardingJourney.findMany.mockResolvedValue([{ domainId: "dom-a" }]);
    db.domainEligibility.findMany.mockResolvedValue([{ domainId: "dom-b" }]);
    expect(await loadJourneyTabs(member)).toEqual({ tabs: [a, b], defaultDomain: b });
  });

  it("shows Core every domain", async () => {
    const a = { id: "dom-a", code: "a", displayName: "A" };
    const b = { id: "dom-b", code: "b", displayName: "B" };
    db.domain.findMany.mockResolvedValue([a, b]);
    db.onboardingJourney.findMany.mockResolvedValue([]);
    expect(await loadJourneyTabs(core)).toEqual({ tabs: [a, b], defaultDomain: a });
  });
});
