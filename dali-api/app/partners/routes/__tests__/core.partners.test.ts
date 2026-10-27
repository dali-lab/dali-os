import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/lib/db", () => ({ prisma: {
  partnerApplication: { findMany: vi.fn() },
  term: { findMany: vi.fn() }, domain: { findMany: vi.fn() },
  partnerCrmSettings: { findUnique: vi.fn(), upsert: vi.fn() },
} }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("../../components/PartnerPlanTable", () => ({ PartnerPlanTable: () => null }));
vi.mock("../../components/PartnerBoard", () => ({ PartnerBoard: () => null }));
vi.mock("../../components/PartnerApplicationModal", () => ({ PartnerApplicationModal: () => null }));
vi.mock("../../components/PartnerSettingsModal", () => ({ PartnerSettingsModal: () => null }));
vi.mock("../../components/PartnerCrmNav", () => ({ PartnerCrmNav: () => null }));
import { prisma } from "~/lib/db";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action, loader } from "../core.partners";

function load() {
  return loader({ request: new Request("http://localhost/core/partners"), params: {}, context: {} } as never);
}
function save(hiddenDomainIds: string[], intent = "set-hidden-domains") {
  const body = new URLSearchParams({ intent });
  for (const id of hiddenDomainIds) body.append("hiddenDomainIds", id);
  return action({ request: new Request("http://localhost/core/partners", { method: "POST", body }), params: {}, context: {} } as never);
}

const now = new Date("2026-10-01T00:00:00Z");
const application = {
  id: "app", title: "Project", stage: "New", position: 0, resultingProjectId: null, source: "Form",
  feeCents: 1200000, nextStep: null, nextStepDueAt: null, lastActivityAt: now, holdUntil: null,
  meetingRequestedAt: null, createdAt: now,
  partnerOrg: null, applicantContact: { name: "Ada" },
  targetTerms: [{ id: "target", planningStatus: "Maybe", plannerNotes: "Note", plannerTodo: "Task", term: { id: "26F", code: "26F", sortKey: 1 } }],
  domains: [{ id: "scope", domainId: "dev", expectedMembers: 3, domain: { displayName: "Dev" } }],
  meetings: [], meetingRequests: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "26F", startDate: now } as never);
  vi.mocked(prisma.partnerApplication.findMany).mockResolvedValue([application] as never);
  vi.mocked(prisma.term.findMany).mockResolvedValue([]);
  vi.mocked(prisma.domain.findMany).mockResolvedValue([]);
  vi.mocked(prisma.partnerCrmSettings.findUnique).mockResolvedValue(null);
});

it("maps each target term's planning metadata and headcount onto the card", async () => {
  expect(await load()).toMatchObject({
    cards: [{
      id: "app", partnerName: "Ada", feeCents: 1200000,
      targetTerms: [{ id: "26F", code: "26F" }],
      plan: [{ targetTermId: "target", termId: "26F", code: "26F", sortKey: 1, planningStatus: "Maybe", plannerNotes: "Note", plannerTodo: "Task" }],
      headcount: [{ id: "scope", domainId: "dev", expectedMembers: 3 }],
    }],
    currentTermStartIso: now.toISOString(),
  });
});

it("prefers the org name over the contact for the partner label", async () => {
  vi.mocked(prisma.partnerApplication.findMany).mockResolvedValue([{ ...application, partnerOrg: { name: "Org" } }] as never);
  expect(await load()).toMatchObject({ cards: [{ partnerName: "Org", orgName: "Org", contactName: "Ada" }] });
});

it("returns the saved hidden headcount columns, or none without a settings row", async () => {
  expect(await load()).toMatchObject({ hiddenDomainIds: [], staleDays: 14 });
  vi.mocked(prisma.partnerCrmSettings.findUnique).mockResolvedValue({ plannerHiddenDomainIds: ["ops"], staleDays: 7 } as never);
  expect(await load()).toMatchObject({ hiddenDomainIds: ["ops"], staleDays: 7 });
});

it("redirects unauthorized visitors before loading applications", async () => {
  vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false } as never);
  expect(await load()).toBeInstanceOf(Response);
  vi.mocked(isNonMember).mockResolvedValueOnce(true);
  expect((await load() as Response).headers.get("Location")).toBe("/portal");
  vi.mocked(isCore).mockResolvedValueOnce(false);
  expect((await load() as Response).headers.get("Location")).toBe("/");
  expect(prisma.partnerApplication.findMany).not.toHaveBeenCalled();
});

it("saves the hidden column set, deduped, and audits it", async () => {
  expect(await save(["ops", "ops", "ux"])).toEqual({ ok: true });
  expect(prisma.partnerCrmSettings.upsert).toHaveBeenCalledWith({
    where: { id: "default" },
    create: { id: "default", plannerHiddenDomainIds: ["ops", "ux"] },
    update: { plannerHiddenDomainIds: ["ops", "ux"] },
  });
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "partner.settings.save", metadata: { plannerHiddenDomainIds: ["ops", "ux"] } }));
});

it("saving no hidden columns shows them all again", async () => {
  await save([]);
  expect(prisma.partnerCrmSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { plannerHiddenDomainIds: [] } }));
});

it("rejects non-Core callers and unknown intents without saving", async () => {
  vi.mocked(isCore).mockResolvedValueOnce(false);
  expect(await save(["ops"])).toMatchObject({ error: expect.stringContaining("permission") });
  expect(await save(["ops"], "other")).toEqual({ error: "Unknown action." });
  expect(prisma.partnerCrmSettings.upsert).not.toHaveBeenCalled();
});
