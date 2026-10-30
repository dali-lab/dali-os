import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findMany: vi.fn() },
    docTag: { findMany: vi.fn() },
    pageLink: { findMany: vi.fn() },
    meetingShareGrant: { findFirst: vi.fn() },
    term: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/public-doc.server", () => ({ publicDocRedirectForPath: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  PAGE_ACCESS_SELECT: { id: true },
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
}));
vi.mock("~/lib/page-sharing.server", () => ({ groupIdsForUser: vi.fn() }));
vi.mock("~/lib/note-path.server", () => ({ notebookItemLocation: vi.fn(), pageItemLocation: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/notebooks.server", () => ({ canManageNotebook: vi.fn() }));
vi.mock("~/lib/notebook-series.server", () => ({ nextNoteTargets: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ isFavorited: vi.fn(), recordPageVisit: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/lib/presence-user", () => ({ getPresenceUser: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  ACTIVE_RECORDING_STATUSES: [],
  latestRecordingFor: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({ ensureOccurrenceRoster: vi.fn() }));
vi.mock("~/lib/drive-crumbs.server", () => ({ driveFolderCrumbs: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { groupIdsForUser } from "~/lib/page-sharing.server";
import { notebookItemLocation, pageItemLocation } from "~/lib/note-path.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canManageNotebook } from "~/lib/notebooks.server";
import { nextNoteTargets } from "~/lib/notebook-series.server";
import { getUserRoles } from "~/lib/roles";
import { latestRecordingFor } from "~/lib/meeting-recording.server";
import { loader } from "../documents.$pageId";

const db = prisma as any;
const LOCATION = {
  scopeId: "projects",
  scopeLabel: "Projects",
  folderId: "f1",
  folders: [
    { id: "p1", title: "Project Alpha" },
    { id: "f1", title: "Meetings" },
  ],
  path: "Projects ▸ Project Alpha ▸ Meetings",
};
const NEXT = [{ meetingId: "m1", meetingTitle: "Weekly sync", occurrenceStart: "2026-10-21T15:00:00.000Z" }];

const page = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "FreeForm",
  archivedAt: null,
  title: "Agenda",
  workspaceType: "Project",
  workspaceId: "p1",
  parentPageId: "nb1",
  createdById: "someone",
  meetingNoteId: null,
  meetingOccurrenceStart: new Date("2026-10-14T15:00:00Z"),
  typography: null,
  updatedAt: new Date("2026-10-14T16:00:00Z"),
  tags: [],
  parent: {
    id: "nb1",
    kind: "Notebook",
    title: "Weekly sync",
    workspaceType: "Project",
    workspaceId: "p1",
    parentPageId: "f1",
    templatePage: null,
  },
  ...over,
});

const call = () =>
  loader({ request: new Request("http://localhost/documents/t1"), params: { pageId: "t1" } } as any) as Promise<any>;

const access = (canEdit: boolean) => ({ canView: true, canEdit, canComment: canEdit });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", firstName: "A", lastName: "B", email: "a@b.c" } } as any);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as any);
  db.page.findUnique.mockResolvedValue(page());
  db.page.findMany.mockResolvedValue([]);
  db.docTag.findMany.mockResolvedValue([]);
  db.pageLink.findMany.mockResolvedValue([]);
  db.meetingShareGrant.findFirst.mockResolvedValue(null);
  db.term.findMany.mockResolvedValue([]);
  vi.mocked(getPageAccessBulk).mockResolvedValue(new Map());
  vi.mocked(groupIdsForUser).mockResolvedValue(["g1"]);
  vi.mocked(notebookItemLocation).mockResolvedValue(LOCATION as any);
  vi.mocked(canManageNotebook).mockResolvedValue(false);
  vi.mocked(nextNoteTargets).mockResolvedValue(NEXT);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: false } as any);
  vi.mocked(latestRecordingFor).mockResolvedValue(null as any);
});

describe("documents.$pageId loader location line", () => {
  it("hands the notebook's filed location and a meeting note's title as the tab label", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);

    const data = await call();

    expect(data.noteLocation).toEqual({ location: LOCATION, tabLabel: "Agenda" });
    expect(notebookItemLocation).toHaveBeenCalledWith(expect.objectContaining({ id: "nb1" }), "u1", expect.any(Request));
  });

  it("labels an untitled meeting note's tab with its occurrence date", async () => {
    db.page.findUnique.mockResolvedValue(page({ title: "" }));
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);

    expect((await call()).noteLocation.tabLabel).toBe("Oct 14, 2026");
  });

  it("labels a tab that is not a meeting note with its title", async () => {
    db.page.findUnique.mockResolvedValue(page({ meetingOccurrenceStart: null }));
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);

    expect((await call()).noteLocation.tabLabel).toBe("Agenda");
  });

  it("has no location for a page outside a notebook", async () => {
    db.page.findUnique.mockResolvedValue(page({ parent: null, parentPageId: null }));
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);

    const data = await call();

    expect(data.noteLocation).toBeNull();
    expect(notebookItemLocation).not.toHaveBeenCalled();
  });

  it("gives a plain document its Drive place when the new shell is on", async () => {
    db.page.findUnique.mockResolvedValue(page({ parent: null, parentPageId: "f1" }));
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(pageItemLocation).mockResolvedValue(LOCATION as any);

    const data = await call();

    expect(isFeatureEnabled).toHaveBeenCalledWith("desktop-tabs", "u1", expect.anything(), expect.any(Request));
    expect(data.docLocation).toEqual(LOCATION);
    expect(pageItemLocation).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "u1", expect.any(Request));
  });

  it("skips the Drive lookup when the new shell is off", async () => {
    db.page.findUnique.mockResolvedValue(page({ parent: null, parentPageId: "f1" }));
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);

    expect((await call()).docLocation).toBeNull();
    expect(pageItemLocation).not.toHaveBeenCalled();
  });

  it("leaves a note's place to its notebook", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    expect((await call()).docLocation).toBeNull();
    expect(pageItemLocation).not.toHaveBeenCalled();
  });

  it("passes the notebook's next-note targets to editors only", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);
    expect((await call()).notebook.nextNotes).toEqual(NEXT);

    vi.mocked(getPageAccess).mockResolvedValue(access(false) as any);
    expect((await call()).notebook.nextNotes).toEqual([]);
  });
});

describe("documents.$pageId loader editViaMeeting", () => {
  it("is true for a share-only editor with a meeting grant, asking only for their own and their groups' grants", async () => {
    vi.mocked(getPageAccess).mockImplementation((async (_u: string, _p: unknown, _r: unknown, opts?: { ignoreShares?: boolean }) =>
      access(!opts?.ignoreShares)) as any);
    db.meetingShareGrant.findFirst.mockResolvedValue({ id: "g" });

    expect((await call()).editViaMeeting).toBe(true);
    expect(db.meetingShareGrant.findFirst).toHaveBeenCalledWith({
      where: {
        pageId: { in: ["nb1", "t1"] },
        OR: [
          { principalType: "User", principalId: "u1" },
          { principalType: "Group", principalId: { in: ["g1"] } },
        ],
      },
      select: { id: true },
    });
  });

  it("is false when base access already edits", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(true) as any);
    db.meetingShareGrant.findFirst.mockResolvedValue({ id: "g" });

    expect((await call()).editViaMeeting).toBe(false);
  });

  it("is false for a share-only editor with no meeting grant", async () => {
    vi.mocked(getPageAccess).mockImplementation((async (_u: string, _p: unknown, _r: unknown, opts?: { ignoreShares?: boolean }) =>
      access(!opts?.ignoreShares)) as any);

    expect((await call()).editViaMeeting).toBe(false);
  });

  it("is false for a viewer and never looks for grants", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(false) as any);

    expect((await call()).editViaMeeting).toBe(false);
    expect(db.meetingShareGrant.findFirst).not.toHaveBeenCalled();
  });
});
