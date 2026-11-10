import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    projectPartner: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    projectAssignment: { findMany: vi.fn() },
    epic: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    projectFile: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => (u ? `resolved:${u}` : null)) }));
vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(async (key: string, opts?: { fileName?: string }) =>
    opts?.fileName ? `save:${key}:${opts.fileName}` : `view:${key}`,
  ),
}));
vi.mock("~/partners/lib/partner-meetings.server", () => ({
  listPartnerMeetingsForContact: vi.fn(),
  listPartnerMeetingRequests: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { listPartnerMeetingsForContact, listPartnerMeetingRequests } from "~/partners/lib/partner-meetings.server";
import { loadPartnerProjectView, resolvePartnerProjectOrgId } from "../partner-project-view.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const PROJECT = {
  id: "p1",
  name: "Example Project",
  iconEmoji: null,
  description: "About it",
  status: "Active",
  imageUrl: "img.png",
  projectTerms: [
    { term: { code: "26S", sortKey: 3, startDate: new Date("2026-03-30T00:00:00Z"), endDate: new Date("2026-06-10T00:00:00Z") } },
    { term: { code: "26W", sortKey: 2, startDate: new Date("2026-01-05T00:00:00Z"), endDate: new Date("2026-03-20T00:00:00Z") } },
  ],
};

function file(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    title: "Brief",
    folderPageId: null,
    currentVersion: { fileName: "brief-v2.pdf", sizeBytes: 10, s3Key: "uploads/brief", contentType: "application/pdf" },
    ...over,
  };
}

function page(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    title: "Doc",
    kind: "Doc",
    parentPageId: null,
    partnerVisible: true,
    iconEmoji: null,
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue(PROJECT);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t26s", code: "26S" } as never);
  db.projectPartner.findFirst.mockResolvedValue(null);
  db.projectAssignment.findMany.mockResolvedValue([]);
  db.epic.findMany.mockResolvedValue([]);
  db.task.findMany.mockResolvedValue([]);
  db.page.findMany.mockResolvedValue([]);
  db.projectFile.findMany.mockResolvedValue([]);
  vi.mocked(listPartnerMeetingsForContact).mockResolvedValue([]);
  vi.mocked(listPartnerMeetingRequests).mockResolvedValue({ pending: [], declined: [] } as never);
});

describe("resolvePartnerProjectOrgId", () => {
  it("returns null without querying when the account has no orgs", async () => {
    expect(await resolvePartnerProjectOrgId("p1", [])).toBeNull();
    expect(db.projectPartner.findFirst).not.toHaveBeenCalled();
  });

  it("only matches links to the account's own orgs, earliest partnership first", async () => {
    db.projectPartner.findFirst.mockResolvedValue({ partnerOrgId: "org-a" });
    expect(await resolvePartnerProjectOrgId("p1", ["org-a", "org-b"])).toBe("org-a");
    expect(db.projectPartner.findFirst).toHaveBeenCalledWith({
      where: { projectId: "p1", partnerOrgId: { in: ["org-a", "org-b"] } },
      select: { partnerOrgId: true },
      orderBy: { startedAt: "asc" },
    });
  });

  it("returns null when none of the account's orgs is linked to the project", async () => {
    expect(await resolvePartnerProjectOrgId("p1", ["org-z"])).toBeNull();
  });
});

describe("loadPartnerProjectView", () => {
  it("returns null for an unknown project without loading anything else", async () => {
    db.project.findUnique.mockResolvedValue(null);
    expect(await loadPartnerProjectView("nope", "org-a")).toBeNull();
    expect(db.epic.findMany).not.toHaveBeenCalled();
    expect(db.projectFile.findMany).not.toHaveBeenCalled();
  });

  it("reads every collection scoped to this project only", async () => {
    await loadPartnerProjectView("p1", "org-a");
    expect(db.projectPartner.findFirst.mock.calls[0][0].where).toEqual({ projectId: "p1", partnerOrgId: "org-a" });
    expect(db.projectAssignment.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", termId: "t26s" });
    expect(db.epic.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", status: { not: "Cancelled" } });
    expect(db.task.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", archivedAt: null, storyId: { not: null } });
    expect(db.page.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceType: "Project",
      workspaceId: "p1",
      archivedAt: null,
    });
    expect(listPartnerMeetingRequests).toHaveBeenCalledWith({ projectId: "p1" });
  });

  it("only ever asks for partner-visible, unarchived files", async () => {
    await loadPartnerProjectView("p1", "org-a");
    expect(db.projectFile.findMany.mock.calls[0][0].where).toEqual({
      projectId: "p1",
      archivedAt: null,
      partnerVisible: true,
    });
    expect(db.page.findMany.mock.calls[0][0].where.OR).toEqual([{ partnerVisible: true }, { kind: "Folder" }]);
  });

  it("gives the member preview (no org) no partnerSince and skips the partnership lookup", async () => {
    const view = await loadPartnerProjectView("p1", null);
    expect(db.projectPartner.findFirst).not.toHaveBeenCalled();
    expect(view!.partnerSince).toBeNull();
  });

  it("reports the partnership start date for the partner's org", async () => {
    db.projectPartner.findFirst.mockResolvedValue({ startedAt: new Date("2025-09-01T00:00:00Z") });
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.partnerSince).toBe("2025-09-01T00:00:00.000Z");
  });

  it("lists project terms and the timeline terms oldest first with resolved image and current term", async () => {
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.project).toMatchObject({ id: "p1", terms: ["26W", "26S"], imageUrl: "resolved:img.png" });
    expect(view!.timelineTerms.map((t) => t.code)).toEqual(["26W", "26S"]);
    expect(view!.currentTermCode).toBe("26S");
  });

  it("skips the roster query and reports no current term when none is active", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(db.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(view!.team).toEqual([]);
    expect(view!.currentTermCode).toBeNull();
  });

  it("shows one roster row per person with their domains joined and no levels", async () => {
    const ada = { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: "ada.png" };
    db.projectAssignment.findMany.mockResolvedValue([
      { user: ada, domain: { name: "Engineering" } },
      { user: { id: "u2", firstName: "Grace", lastName: "Hopper", photoUrl: null }, domain: { name: "Design" } },
      { user: ada, domain: { name: "Design" } },
    ]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.team).toEqual([
      { name: "Ada Lovelace", domains: ["Design", "Engineering"], photoUrl: "resolved:ada.png" },
      { name: "Grace Hopper", domains: ["Design"], photoUrl: null },
    ]);
  });

  it("strips planning internals from the epics a partner receives", async () => {
    db.epic.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Epic",
        description: "Why",
        status: "InProgress",
        startsAt: new Date("2026-04-01T00:00:00Z"),
        endsAt: null,
        descriptionDocId: "doc-secret",
        dependsOn: [{ id: "e0" }],
        stories: [
          {
            id: "s1",
            title: "Story",
            notes: "n",
            status: "Open",
            startsAt: null,
            endsAt: null,
            successMetric: "secret metric",
            acceptanceCriteria: "secret criteria",
            category: "X",
            priority: "High",
          },
        ],
      },
    ]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.editableEpics).toEqual([
      {
        id: "e1",
        title: "Epic",
        description: "Why",
        status: "InProgress",
        startsAt: "2026-04-01T00:00:00.000Z",
        endsAt: null,
        descriptionDocId: null,
        dependsOn: [],
        stories: [
          {
            id: "s1",
            title: "Story",
            notes: "n",
            status: "Open",
            startsAt: null,
            endsAt: null,
            dependsOn: [],
            successMetric: null,
            acceptanceCriteria: null,
            category: null,
            priority: null,
          },
        ],
      },
    ]);
  });

  it("places stories by their tasks' dates but never sends tasks to the partner", async () => {
    db.epic.findMany.mockResolvedValue([
      {
        id: "e1",
        title: "Epic",
        description: null,
        status: "Open",
        startsAt: null,
        endsAt: null,
        stories: [{ id: "s1", title: "Story", notes: null, status: "Open", startsAt: null, endsAt: null }],
      },
    ]);
    db.task.findMany.mockResolvedValue([
      { id: "t1", storyId: "s1", startsAt: new Date("2026-04-06T00:00:00Z"), dueAt: new Date("2026-04-10T00:00:00Z") },
    ]);
    const view = await loadPartnerProjectView("p1", "org-a");
    const story = view!.timelineEpics[0].stories[0];
    expect(story.startsAt).toBe("2026-04-06T00:00:00.000Z");
    expect(story.endsAt).toBe("2026-04-10T00:00:00.000Z");
    expect(story.tasks ?? []).toEqual([]);
    expect(view!.timelineEpics[0].tasks).toEqual([]);
  });

  it("only requests meetings for the signed-in contact, and none for the preview", async () => {
    await loadPartnerProjectView("p1", "org-a", { email: "pat@example.com" });
    expect(listPartnerMeetingsForContact).toHaveBeenCalledWith("pat@example.com");
    vi.mocked(listPartnerMeetingsForContact).mockClear();
    await loadPartnerProjectView("p1", null, null);
    expect(listPartnerMeetingsForContact).not.toHaveBeenCalled();
  });

  it("passes pending and declined meeting requests through", async () => {
    const pending = [{ id: "r1" }];
    const declined = [{ id: "r2" }];
    vi.mocked(listPartnerMeetingRequests).mockResolvedValue({ pending, declined } as never);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.pendingMeetingRequests).toBe(pending);
    expect(view!.declinedMeetingRequests).toBe(declined);
  });
});

describe("loadPartnerProjectView drive", () => {
  it("signs a view URL and a save URL named after the title for each shared file", async () => {
    db.projectFile.findMany.mockResolvedValue([file()]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.drive.files).toEqual([
      {
        id: "f1",
        title: "Brief",
        fileName: "brief-v2.pdf",
        sizeBytes: 10,
        contentType: "application/pdf",
        downloadUrl: "view:uploads/brief",
        saveUrl: "save:uploads/brief:Brief.pdf",
      },
    ]);
  });

  it("returns null URLs for a file with no current version", async () => {
    db.projectFile.findMany.mockResolvedValue([file({ currentVersion: null })]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.drive.files[0]).toMatchObject({ fileName: null, downloadUrl: null, saveUrl: null });
  });

  it("lists shared docs at the root and omits docs that are not partner-visible", async () => {
    db.page.findMany.mockResolvedValue([page(), page({ id: "d2", partnerVisible: false })]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.drive.docs.map((d) => d.id)).toEqual(["d1"]);
    expect(view!.drive.docs[0].updatedAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("shows a folder only because something shared is in it, holding only the shared items", async () => {
    db.page.findMany.mockResolvedValue([
      page({ id: "fold-full", title: "Full", kind: "Folder", partnerVisible: false }),
      page({ id: "fold-empty", title: "Empty", kind: "Folder", partnerVisible: false }),
      page({ id: "d1", parentPageId: "fold-full" }),
      page({ id: "d-private", parentPageId: "fold-full", partnerVisible: false }),
    ]);
    db.projectFile.findMany.mockResolvedValue([file({ folderPageId: "fold-full" })]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.drive.folders).toHaveLength(1);
    expect(view!.drive.folders[0]).toMatchObject({ id: "fold-full", title: "Full" });
    expect(view!.drive.folders[0].docs.map((d) => d.id)).toEqual(["d1"]);
    expect(view!.drive.folders[0].files.map((f) => f.id)).toEqual(["f1"]);
    expect(view!.drive.docs).toEqual([]);
    expect(view!.drive.files).toEqual([]);
  });

  it("falls back to the root for items whose folder is no longer in the tree", async () => {
    db.page.findMany.mockResolvedValue([page({ parentPageId: "gone" })]);
    db.projectFile.findMany.mockResolvedValue([file({ folderPageId: "gone" })]);
    const view = await loadPartnerProjectView("p1", "org-a");
    expect(view!.drive.folders).toEqual([]);
    expect(view!.drive.docs.map((d) => d.id)).toEqual(["d1"]);
    expect(view!.drive.files.map((f) => f.id)).toEqual(["f1"]);
  });
});
