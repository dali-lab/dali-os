import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { scheduledMeeting: { findUnique: vi.fn(), findMany: vi.fn() }, page: { findUnique: vi.fn() } },
}));
vi.mock("~/mentorship/lib/pair-suggestion.server", () => ({ findMentorPair: vi.fn() }));
vi.mock("~/mentorship/lib/pair-notebook.server", () => ({
  pairNotebookKey: (p: { mentorId: string; menteeId: string }) => `pair:${p.mentorId}:${p.menteeId}`,
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccessBulk: vi.fn(), PAGE_ACCESS_SELECT: { id: true } }));
vi.mock("~/lib/drive-receivers.server", () => ({
  findReceiver: vi.fn(),
  projectSlot: (projectId: string) => ({ processType: "Project", processId: projectId, folderType: "Meetings" }),
  singletonSlot: (processType: string) => ({ processType, processId: processType.toLowerCase(), folderType: "Meetings" }),
  resolveFilingFolder: vi.fn(),
}));
vi.mock("~/lib/note-path.server", () => ({
  formatFiledPath: (parts: string[]) => parts.join(" ▸ "),
  notebookLocationParts: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { findReceiver, resolveFilingFolder } from "~/lib/drive-receivers.server";
import { notebookLocationParts } from "~/lib/note-path.server";
import { resolveDefaultNotebook } from "~/lib/notebook-default.server";
import { findMentorPair } from "~/mentorship/lib/pair-suggestion.server";

const m = prisma as any;

const nb = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Notebook ${id}`,
  kind: "Notebook",
  archivedAt: null,
  workspaceType: "Lab",
  workspaceId: null,
  parentPageId: `folder-of-${id}`,
  ...over,
});

const canView = (...ids: string[]) =>
  vi.mocked(getPageAccessBulk).mockImplementation((async (_u: string, rows: { id: string }[]) =>
    new Map(rows.map((r) => [r.id, { canView: ids.includes(r.id), canEdit: false, canComment: false }]))) as never);

beforeEach(() => {
  vi.resetAllMocks();
  m.scheduledMeeting.findUnique.mockResolvedValue(null);
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  vi.mocked(findReceiver).mockResolvedValue(null);
  vi.mocked(notebookLocationParts).mockImplementation((async (n: { parentPageId: string | null; workspaceType: string }) =>
    n.parentPageId ? [`path:${n.parentPageId}`] : [n.workspaceType === "Project" ? "Projects" : "General"]) as never);
  m.page.findUnique.mockResolvedValue(null);
  vi.mocked(findMentorPair).mockResolvedValue(null);
  canView("s1", "h1", "h2", "h3", "pair-nb");
});

describe("resolveDefaultNotebook: series", () => {
  it("wins over the group's history", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: nb("s1") });
    m.scheduledMeeting.findMany.mockResolvedValue([{ notebook: nb("h1") }]);

    const out = await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "Group", groupId: "g1" });

    expect(out.kind).toBe("series");
    expect(out.notebook).toEqual({ id: "s1", title: "Notebook s1", path: "path:folder-of-s1" });
    expect(m.scheduledMeeting.findMany).not.toHaveBeenCalled();
  });

  it("is skipped when the series notebook is trashed or unreadable", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: nb("s1", { archivedAt: new Date() }) });
    expect((await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "None" })).kind).toBe("new");

    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: nb("s1") });
    canView();
    expect((await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "None" })).kind).toBe("new");
  });

  it("is skipped when the meeting has no notebook", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: null });
    expect((await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "None" })).kind).toBe("new");
  });
});

describe("resolveDefaultNotebook: history", () => {
  const history = (...ids: string[]) => m.scheduledMeeting.findMany.mockResolvedValue(ids.map((id) => ({ notebook: nb(id) })));

  it("is the notebook of the latest same-group meeting", async () => {
    history("h1", "h2");

    const out = await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group", groupId: "g1" });

    expect(out).toMatchObject({ kind: "history", notebook: { id: "h1" } });
  });

  it("asks only for the group's live, uncancelled meetings, newest first", async () => {
    await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group", groupId: "g1" });

    const args = m.scheduledMeeting.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      scopeType: "Group",
      scopeId: "g1",
      status: { not: "Cancelled" },
      notebook: { is: { kind: "Notebook", archivedAt: null } },
    });
    expect(args.orderBy).toEqual([{ selectedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]);
  });

  it("skips a notebook the actor cannot view and takes the next", async () => {
    history("h1", "h2");
    canView("h2");

    expect(await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group", groupId: "g1" })).toMatchObject({
      kind: "history",
      notebook: { id: "h2" },
    });
  });

  it("is new when none of them can be viewed", async () => {
    history("h1");
    canView();

    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group", groupId: "g1" })).kind).toBe("new");
  });

  it("is new when the group has no meetings with a notebook", async () => {
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group", groupId: "g1" })).kind).toBe("new");
  });

  it("gives a UserList invite no history", async () => {
    history("h1");

    const out = await resolveDefaultNotebook({ actorId: "u1", scopeType: "UserList" });

    expect(out).toMatchObject({ kind: "new", notebook: null });
    expect(m.scheduledMeeting.findMany).not.toHaveBeenCalled();
  });

  it("gives a Group invite without a group id no history", async () => {
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "Group" })).kind).toBe("new");
    expect(m.scheduledMeeting.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveDefaultNotebook: newPath", () => {
  it("is the project's Meetings receiver", async () => {
    vi.mocked(findReceiver).mockResolvedValue("recv-p1");
    vi.mocked(notebookLocationParts).mockResolvedValue(["Projects", "Atlas", "Meetings"]);

    const out = await resolveDefaultNotebook({ actorId: "u1", scopeType: "None", projectId: "p1" });

    expect(out.newPath).toBe("Projects ▸ Atlas ▸ Meetings");
    expect(findReceiver).toHaveBeenCalledWith({ processType: "Project", processId: "p1", folderType: "Meetings" });
    expect(notebookLocationParts).toHaveBeenCalledWith(
      { parentPageId: "recv-p1", workspaceType: "Project", workspaceId: "p1" },
      "u1",
      undefined,
    );
  });

  it("is Core's Meetings receiver for a Core meeting", async () => {
    vi.mocked(findReceiver).mockResolvedValue("recv-core");
    vi.mocked(notebookLocationParts).mockResolvedValue(["Core", "Meetings"]);

    const out = await resolveDefaultNotebook({ actorId: "u1", scopeType: "None", isCoreMeeting: true });

    expect(out.newPath).toBe("Core ▸ Meetings");
    expect(findReceiver).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Meetings" });
  });

  it("is the Lab's Meetings receiver otherwise", async () => {
    vi.mocked(findReceiver).mockResolvedValue("recv-lab");
    vi.mocked(notebookLocationParts).mockResolvedValue(["General", "Meetings"]);

    const out = await resolveDefaultNotebook({ actorId: "u1", scopeType: "None" });

    expect(out.newPath).toBe("General ▸ Meetings");
    expect(findReceiver).toHaveBeenCalledWith({ processType: "Lab", processId: "lab", folderType: "Meetings" });
  });

  it("prefers the project over Core when both are given", async () => {
    await resolveDefaultNotebook({ actorId: "u1", scopeType: "None", projectId: "p1", isCoreMeeting: true });

    expect(findReceiver).toHaveBeenCalledWith(expect.objectContaining({ processType: "Project" }));
  });

  it("stops at the space when no receiver exists, and creates nothing", async () => {
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "None", projectId: "p1" })).newPath).toBe("Projects");
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "None", isCoreMeeting: true })).newPath).toBe("Core");
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "None" })).newPath).toBe("General");
    expect(resolveFilingFolder).not.toHaveBeenCalled();
  });

  it("rides along with a series or history result", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: nb("s1") });
    vi.mocked(findReceiver).mockResolvedValue("recv-lab");

    const out = await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "None" });

    expect(out.kind).toBe("series");
    expect(out.newPath).toBe("path:recv-lab");
  });
});

describe("resolveDefaultNotebook: a mentor's pair notebook", () => {
  const pair = { mentorId: "u1", menteeId: "mia", projectId: "p1", termId: "t1", domainId: "d1" };
  const ask = () => resolveDefaultNotebook({ actorId: "u1", scopeType: "UserList", pairMenteeId: "mia" });

  beforeEach(() => {
    vi.mocked(findMentorPair).mockResolvedValue(pair);
    m.page.findUnique.mockResolvedValue(nb("pair-nb"));
  });

  it("is the pair notebook when it already exists", async () => {
    expect(await ask()).toMatchObject({ kind: "pair", notebook: { id: "pair-nb", path: "path:folder-of-pair-nb" } });
    expect(findMentorPair).toHaveBeenCalledWith("u1", "mia", undefined);
    expect(m.page.findUnique.mock.calls[0]![0].where).toEqual({ notebookKey: "pair:u1:mia" });
  });

  it("loses to the meeting's own series notebook", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue({ notebook: nb("s1") });

    expect((await resolveDefaultNotebook({ actorId: "u1", meetingId: "m1", scopeType: "UserList", pairMenteeId: "mia" })).kind).toBe("series");
  });

  it("is new, and makes nothing, when the pair notebook does not exist yet", async () => {
    m.page.findUnique.mockResolvedValue(null);

    expect(await ask()).toMatchObject({ kind: "new", notebook: null });
  });

  it("is new for an archived or non-notebook page under that key", async () => {
    m.page.findUnique.mockResolvedValue(nb("pair-nb", { archivedAt: new Date() }));
    expect((await ask()).kind).toBe("new");
    m.page.findUnique.mockResolvedValue(nb("pair-nb", { kind: "Document" }));
    expect((await ask()).kind).toBe("new");
  });

  it("is new when the actor cannot view it", async () => {
    canView();

    expect((await ask()).kind).toBe("new");
  });

  it("is new when the actor has no pair with that person", async () => {
    vi.mocked(findMentorPair).mockResolvedValue(null);

    expect((await ask()).kind).toBe("new");
    expect(m.page.findUnique).not.toHaveBeenCalled();
  });

  it("looks nothing up without a mentee", async () => {
    expect((await resolveDefaultNotebook({ actorId: "u1", scopeType: "UserList" })).kind).toBe("new");
    expect(findMentorPair).not.toHaveBeenCalled();
  });
});
