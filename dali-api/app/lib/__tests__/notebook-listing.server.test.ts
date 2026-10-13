import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findMany: vi.fn(), groupBy: vi.fn() },
    scheduledMeeting: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccessBulk: vi.fn(), PAGE_ACCESS_SELECT: { id: true } }));
vi.mock("~/lib/note-path.server", () => ({
  formatFiledPath: (parts: string[]) => parts.join(" ▸ "),
  notebookLocationParts: vi.fn(async () => ["Lab", "Meetings"]),
}));

import { prisma } from "~/lib/db";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
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

  it("does not read notebookKey", async () => {
    m.page.findMany.mockResolvedValueOnce([nb("a")]);
    access(["a"]);

    await listNotebooks({ actorId: "u1" });

    expect(m.page.findMany.mock.calls[0][0].select).not.toHaveProperty("notebookKey");
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
});
