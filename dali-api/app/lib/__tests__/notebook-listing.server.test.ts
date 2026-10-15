import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findMany: vi.fn(), groupBy: vi.fn() },
    scheduledMeeting: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/drive-roots.server", () => ({ findRoot: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccessBulk: vi.fn(), PAGE_ACCESS_SELECT: { id: true } }));
vi.mock("~/lib/note-path.server", () => ({
  formatFiledPath: (parts: string[]) => parts.join(" ▸ "),
  notebookLocationPartsBulk: vi.fn(
    async (notebooks: { id: string }[]) => new Map(notebooks.map((n) => [n.id, ["Lab", "Meetings"]])),
  ),
}));

import { prisma } from "~/lib/db";
import { findRoot } from "~/lib/drive-roots.server";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { notebookLocationPartsBulk } from "~/lib/note-path.server";
import { meetingNotebookIdentity } from "~/lib/meeting-notebook";
import { listNotebooks, MAX_LISTED } from "~/lib/notebook-listing.server";

const m = prisma as any;
const EDIT = { canView: true, canEdit: true, canComment: true };
const VIEW = { canView: true, canEdit: false, canComment: true };

const nb = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Notebook ${id}`,
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: "f1",
  notebookKey: null,
  ...over,
});

const meeting = (over: Record<string, unknown> = {}) => ({
  title: "Sync",
  meetingType: "Other",
  meetingTypeLabel: "Sync",
  projectId: null,
  isCoreMeeting: false,
  scopeType: "UserList",
  scopeId: null,
  organizerId: "u1",
  participantUserIds: ["u2"],
  guestEmails: [],
  notebookId: null,
  ...over,
});

function access(editable: string[], viewOnly: string[] = []) {
  const entries: [string, typeof EDIT][] = [
    ...editable.map((id): [string, typeof EDIT] => [id, EDIT]),
    ...viewOnly.map((id): [string, typeof EDIT] => [id, VIEW]),
  ];
  vi.mocked(getPageAccessBulk).mockImplementation((async () => new Map(entries)) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findMany.mockResolvedValue([]);
  m.page.groupBy.mockResolvedValue([]);
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  m.scheduledMeeting.findUnique.mockResolvedValue(null);
});

describe("listNotebooks", () => {
  it("lists only notebooks the viewer can edit", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a"), nb("b"), nb("c")]);
    access(["a", "c"], ["b"]);

    const out = await listNotebooks({ actorId: "u1" });

    expect(out.map((r) => r.id).sort()).toEqual(["a", "c"]);
  });

  it("scans only the workspace asked for", async () => {
    await listNotebooks({ actorId: "u1", space: { workspaceType: "Project", workspaceId: "p1" } });

    expect(m.page.findMany.mock.calls[0][0].where).toMatchObject({
      kind: "Notebook",
      workspaceType: "Project",
      workspaceId: "p1",
    });
  });

  describe("the Core space", () => {
    const folders = (...levels: string[][]) => {
      for (const ids of levels) m.page.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
    };

    it("scans only Lab notebooks filed in the Core root or a folder under it", async () => {
      vi.mocked(findRoot).mockResolvedValue("core-root");
      folders(["f1", "f2"], ["f3"], []);

      await listNotebooks({ actorId: "u1", space: { workspaceType: "Core", workspaceId: null } });

      expect(findRoot).toHaveBeenCalledWith("core");
      expect(m.page.findMany.mock.calls[0][0].where).toEqual({
        parentPageId: { in: ["core-root"] },
        kind: "Folder",
        archivedAt: null,
      });
      expect(m.page.findMany.mock.calls[1][0].where.parentPageId).toEqual({ in: ["f1", "f2"] });
      expect(m.page.findMany.mock.calls[2][0].where.parentPageId).toEqual({ in: ["f3"] });
      const notebooks = m.page.findMany.mock.calls[3][0].where;
      expect(notebooks).toMatchObject({
        kind: "Notebook",
        workspaceType: "Lab",
        parentPageId: { in: ["core-root", "f1", "f2", "f3"] },
      });
      expect(notebooks).not.toHaveProperty("workspaceId");
    });

    it("finds a notebook that sits right in the Core root", async () => {
      vi.mocked(findRoot).mockResolvedValue("core-root");
      folders([]);
      m.page.findMany.mockResolvedValueOnce([nb("a", { parentPageId: "core-root" })]);
      access(["a"]);

      expect((await listNotebooks({ actorId: "u1", space: { workspaceType: "Core", workspaceId: null } })).map((r) => r.id)).toEqual(["a"]);
    });

    it("lists nothing before Core has a root, rather than falling back to every Lab notebook", async () => {
      vi.mocked(findRoot).mockResolvedValue(null);

      expect(await listNotebooks({ actorId: "u1", space: { workspaceType: "Core", workspaceId: null } })).toEqual([]);
      expect(m.page.findMany.mock.calls[0][0].where).toMatchObject({ kind: "Notebook", parentPageId: { in: [] } });
    });

    it("keeps the search inside Core", async () => {
      vi.mocked(findRoot).mockResolvedValue("core-root");
      folders([]);

      await listNotebooks({ actorId: "u1", space: { workspaceType: "Core", workspaceId: null }, q: "week" });

      expect(m.page.findMany.mock.calls[1][0].where).toMatchObject({
        parentPageId: { in: ["core-root"] },
        title: { contains: "week", mode: "insensitive" },
      });
    });
  });

  it("scans every workspace when none is asked for", async () => {
    await listNotebooks({ actorId: "u1" });

    expect(m.page.findMany.mock.calls[0][0].where).not.toHaveProperty("workspaceType");
  });

  it("returns nothing, and runs no further queries, when none are editable", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a")]);
    access([], ["a"]);

    expect(await listNotebooks({ actorId: "u1" })).toEqual([]);
    expect(m.page.groupBy).not.toHaveBeenCalled();
  });

  it("shapes each row with its path, note count and latest note date", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a", { title: "Weekly" })]);
    access(["a"]);
    m.page.groupBy.mockResolvedValue([
      {
        parentPageId: "a",
        _count: { _all: 4 },
        _max: { meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z"), createdAt: new Date("2026-09-12T15:00:00Z") },
      },
    ]);

    expect(await listNotebooks({ actorId: "u1" })).toEqual([
      {
        id: "a",
        title: "Weekly",
        path: "Lab ▸ Meetings",
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: "f1",
        tabCount: 4,
        lastNoteAt: "2026-09-12T15:00:00.000Z",
        suggested: false,
      },
    ]);
  });

  it("reports an empty notebook with no date", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a")]);
    access(["a"]);

    expect(await listNotebooks({ actorId: "u1" })).toMatchObject([{ tabCount: 0, lastNoteAt: null }]);
  });

  it("narrows by title when a query is given", async () => {
    await listNotebooks({ actorId: "u1", q: "  week " });

    expect(m.page.findMany.mock.calls[0][0].where).toMatchObject({
      kind: "Notebook",
      archivedAt: null,
      title: { contains: "week", mode: "insensitive" },
    });
  });

  it("filters by nothing when the query is blank", async () => {
    await listNotebooks({ actorId: "u1", q: "   " });

    expect(m.page.findMany.mock.calls[0][0].where).not.toHaveProperty("title");
  });

  it("suggests a notebook in the given project, ahead of the more recent ones", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("lab"), nb("proj", { workspaceType: "Project", workspaceId: "p1" })]);
    access(["lab", "proj"]);
    m.page.groupBy.mockResolvedValue([
      { parentPageId: "lab", _count: { _all: 1 }, _max: { meetingOccurrenceStart: new Date("2026-09-20T00:00:00Z"), createdAt: null } },
      { parentPageId: "proj", _count: { _all: 1 }, _max: { meetingOccurrenceStart: new Date("2026-01-20T00:00:00Z"), createdAt: null } },
    ]);

    const out = await listNotebooks({ actorId: "u1", projectId: "p1" });

    expect(out.map((r) => [r.id, r.suggested])).toEqual([
      ["proj", true],
      ["lab", false],
    ]);
  });

  it("suggests the series' default and the notebook holding one of its notes", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("other"), nb("default"), nb("holds")]);
    access(["other", "default", "holds"]);
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ notebookId: "default" }));
    m.page.findMany.mockResolvedValueOnce([{ parentPageId: "holds", meetingNoteId: "m1", meetingNote: meeting() }]);

    const out = await listNotebooks({ actorId: "u1", meetingId: "m1" });

    expect(out.filter((r) => r.suggested).map((r) => r.id).sort()).toEqual(["default", "holds"]);
    expect(out.find((r) => r.id === "other")?.suggested).toBe(false);
  });

  it("suggests a notebook used by a meeting with the same guest set, via the identity key", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("same"), nb("different")]);
    access(["same", "different"]);
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ guestEmails: ["g@x.org"] }));
    m.scheduledMeeting.findMany.mockResolvedValue([
      { ...meeting({ guestEmails: ["G@x.org"] }), notebookId: "same" },
      { ...meeting({ guestEmails: ["someone@else.org"] }), notebookId: "different" },
    ]);

    const out = await listNotebooks({ actorId: "u1", meetingId: "m1" });

    expect(out.map((r) => [r.id, r.suggested])).toEqual([
      ["same", true],
      ["different", false],
    ]);
  });

  it("matches a legacy notebook by its notebook key", async () => {
    const identity = meetingNotebookIdentity(
      { ...meeting(), meetingType: "Other" } as never,
      null,
    );
    m.page.findMany.mockResolvedValueOnce([nb("legacy", { notebookKey: identity.key })]);
    access(["legacy"]);
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting());

    expect(await listNotebooks({ actorId: "u1", meetingId: "m1" })).toMatchObject([{ id: "legacy", suggested: true }]);
  });

  it("looks up no meeting data when no meeting is given", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a")]);
    access(["a"]);

    await listNotebooks({ actorId: "u1" });

    expect(m.scheduledMeeting.findMany).not.toHaveBeenCalled();
    expect(m.scheduledMeeting.findUnique).not.toHaveBeenCalled();
  });

  it("caps the list", async () => {
    const many = Array.from({ length: MAX_LISTED + 10 }, (_, i) => nb(`n${i}`));
    m.page.findMany.mockResolvedValueOnce(many);
    access(many.map((r) => r.id));

    expect(await listNotebooks({ actorId: "u1" })).toHaveLength(MAX_LISTED);
  });

  it("resolves every listed path in one bulk call, for the listed notebooks only", async () => {
    const many = Array.from({ length: MAX_LISTED + 10 }, (_, i) => nb(`n${i}`));
    m.page.findMany.mockResolvedValueOnce(many);
    access(many.map((r) => r.id));
    const request = new Request("http://os.test/api/notebooks");

    const out = await listNotebooks({ actorId: "u1", request });

    expect(notebookLocationPartsBulk).toHaveBeenCalledTimes(1);
    const [asked, viewer, req] = vi.mocked(notebookLocationPartsBulk).mock.calls[0];
    expect(asked.map((n) => n.id).sort()).toEqual(out.map((r) => r.id).sort());
    expect(viewer).toBe("u1");
    expect(req).toBe(request);
  });

  it("joins the resolved parts into each row's path", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a")]);
    access(["a"]);
    vi.mocked(notebookLocationPartsBulk).mockResolvedValueOnce(new Map([["a", ["Projects", "Cortex", "Notes"]]]));

    expect(await listNotebooks({ actorId: "u1" })).toMatchObject([{ path: "Projects ▸ Cortex ▸ Notes" }]);
  });
});

describe("listNotebooks scoped to a space", () => {
  it("filters the page query by the space's workspace", async () => {
    await listNotebooks({ actorId: "u1", space: { workspaceType: "Project", workspaceId: "p1" } });

    expect(m.page.findMany.mock.calls[0][0].where).toMatchObject({
      kind: "Notebook",
      archivedAt: null,
      workspaceType: "Project",
      workspaceId: "p1",
    });
  });

  it("filters Lab by a null workspace id and still honours the title search and the scan cap", async () => {
    await listNotebooks({ actorId: "u1", q: " sync ", space: { workspaceType: "Lab", workspaceId: null } });

    const args = m.page.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ workspaceType: "Lab", workspaceId: null, title: { contains: "sync" } });
    expect(args.take).toBe(300);
  });

  it("scans every workspace when no space is given", async () => {
    await listNotebooks({ actorId: "u1" });

    const where = m.page.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("workspaceType");
    expect(where).not.toHaveProperty("workspaceId");
  });
});
