import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    project: { findUnique: vi.fn() },
    scheduledMeeting: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
  getPageAccessBulk: vi.fn(),
  isUnderGoverningScope: vi.fn(),
  PAGE_ACCESS_SELECT: { id: true },
}));
vi.mock("~/lib/pages", () => ({
  collectSubtree: vi.fn(),
  createLabPage: vi.fn(),
  createNotebookTab: vi.fn(),
  createProjectPage: vi.fn(),
  moveIntoNotebook: vi.fn(),
  pageDepth: vi.fn(),
  trashNotebookIfAbandoned: vi.fn(),
  MAX_PAGE_DEPTH: 6,
}));
vi.mock("~/lib/scheduled-meeting", () => ({ resolveMeetingOccurrence: vi.fn(), seedPageFromTemplate: vi.fn() }));
vi.mock("~/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn(), removeMeetingShares: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess, getPageAccessBulk, isUnderGoverningScope } from "~/lib/pageAccess.server";
import {
  collectSubtree,
  createLabPage,
  createNotebookTab,
  createProjectPage,
  moveIntoNotebook,
  pageDepth,
  trashNotebookIfAbandoned,
} from "~/lib/pages";
import { resolveMeetingOccurrence, seedPageFromTemplate } from "~/lib/scheduled-meeting";
import { formatDateShort } from "~/lib/display";
import { removeMeetingShares, syncMeetingShares } from "~/lib/meeting-shares.server";
import { PageNameConflictError } from "~/lib/page-names.server";
import {
  NotebookError,
  addToNotebook,
  attachNote,
  canManageNotebook,
  createBlankNote,
  createNotebook,
  detachNote,
  dissolveNotebook,
  getNotebook,
  mergeNotebooks,
  notebookErrorResponse,
  setNotebookTemplate,
  setSeriesNotebook,
  trashNotebook,
} from "~/lib/notebooks.server";

const m = prisma as any;
const FULL = { canView: true, canEdit: true, canComment: true };
const VIEW_ONLY = { canView: true, canEdit: false, canComment: true };
const NONE = { canView: false, canEdit: false, canComment: false };

const OCC = new Date("2026-09-10T15:00:00.000Z");

function notebookRow(over: Record<string, unknown> = {}) {
  return {
    id: "nb1",
    kind: "Notebook",
    title: "Weekly",
    archivedAt: null,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: "folder1",
    notebookKey: null,
    templatePageId: null,
    ...over,
  };
}
function docRow(over: Record<string, unknown> = {}) {
  return {
    id: "doc1",
    kind: "FreeForm",
    archivedAt: null,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: null,
    meetingNoteId: null,
    projectAsOverview: null,
    projectAsPRD: null,
    ...over,
  };
}
function meetingRow(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    organizerId: "org1",
    status: "Confirmed",
    notebookId: null,
    selectedAt: OCC,
    createdAt: OCC,
    durationMinutes: 30,
    recurrenceRule: null,
    externalEventId: null,
    ...over,
  };
}

/** Page rows by id for findUnique. */
function pages(rows: Record<string, unknown>) {
  m.page.findUnique.mockImplementation(async ({ where }: any) => rows[where.id] ?? null);
}
/** Access by page id; default FULL. */
function access(byId: Record<string, typeof FULL>) {
  vi.mocked(getPageAccess).mockImplementation((async (_u: string, p: any) =>
    byId[typeof p === "string" ? p : p.id] ?? FULL) as never);
}

async function rejection(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(NotebookError);
  return err as NotebookError;
}

beforeEach(() => {
  vi.resetAllMocks();
  access({});
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isUnderGoverningScope).mockResolvedValue(false);
  vi.mocked(pageDepth).mockResolvedValue(0);
  vi.mocked(createLabPage).mockResolvedValue({ id: "new-nb" });
  vi.mocked(createProjectPage).mockResolvedValue({ id: "new-nb" });
  vi.mocked(collectSubtree).mockResolvedValue({ ids: [], height: 0 });
  vi.mocked(moveIntoNotebook).mockResolvedValue(undefined);
  vi.mocked(resolveMeetingOccurrence).mockResolvedValue({ originalStart: OCC, start: OCC, end: OCC });
  m.page.update.mockResolvedValue({});
  m.page.updateMany.mockResolvedValue({ count: 0 });
  m.page.findMany.mockResolvedValue([]);
  m.page.findFirst.mockResolvedValue(null);
  m.page.count.mockResolvedValue(0);
  m.scheduledMeeting.update.mockResolvedValue({});
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  vi.mocked(syncMeetingShares).mockResolvedValue(undefined);
  vi.mocked(removeMeetingShares).mockResolvedValue(undefined);
  m.scheduledMeeting.updateMany.mockResolvedValue({ count: 0 });
  m.$transaction.mockResolvedValue([]);
});

describe("notebookErrorResponse", () => {
  it("is the error's status and message", async () => {
    const res = notebookErrorResponse(new NotebookError("nope", 409));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("rethrows anything else", () => {
    expect(() => notebookErrorResponse(new Error("boom"))).toThrow("boom");
  });
});

describe("createNotebook", () => {
  const lab = {
    title: "Standups",
    workspaceType: "Lab" as const,
    workspaceId: null,
    parentPageId: null,
    templatePageId: null,
    actorId: "u1",
  };

  it("creates a Notebook-kind page at the lab top level with no auto-grouping key", async () => {
    expect(await createNotebook(lab)).toEqual({ id: "new-nb" });
    expect(createLabPage).toHaveBeenCalledWith({
      title: "Standups",
      createdById: "u1",
      parentPageId: null,
      kind: "Notebook",
      restricted: false,
    });
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("trims the title and refuses an empty one", async () => {
    await createNotebook({ ...lab, title: "  Standups  " });
    expect(vi.mocked(createLabPage).mock.calls[0][0].title).toBe("Standups");
    expect((await rejection(createNotebook({ ...lab, title: "   " }))).status).toBe(400);
  });

  it("surfaces a same-named notebook in the folder as a 409 with the clash message", async () => {
    vi.mocked(createLabPage).mockRejectedValueOnce(
      new PageNameConflictError("A notebook named “Standups” already exists here"),
    );
    const res = notebookErrorResponse(await createNotebook(lab).catch((e) => e));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A notebook named “Standups” already exists here" });
  });

  it("403s a non-member for a lab notebook", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect((await rejection(createNotebook(lab))).status).toBe(403);
    expect(createLabPage).not.toHaveBeenCalled();
  });

  it("starts Restricted inside a scoped folder", async () => {
    pages({ folder1: { workspaceType: "Lab", workspaceId: null, kind: "Folder", archivedAt: null } });
    vi.mocked(isUnderGoverningScope).mockResolvedValue(true);
    await createNotebook({ ...lab, parentPageId: "folder1" });
    expect(vi.mocked(createLabPage).mock.calls[0][0]).toMatchObject({ parentPageId: "folder1", restricted: true });
  });

  it("creates in a project for a project member", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    m.project.findUnique.mockResolvedValue({ id: "p1" });
    await createNotebook({ ...lab, workspaceType: "Project", workspaceId: "p1" });
    expect(createProjectPage).toHaveBeenCalledWith({
      projectId: "p1",
      title: "Standups",
      createdById: "u1",
      parentPageId: null,
      kind: "Notebook",
    });
  });

  it("lets Core create in any project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    m.project.findUnique.mockResolvedValue({ id: "p1" });
    await createNotebook({ ...lab, workspaceType: "Project", workspaceId: "p1" });
    expect(createProjectPage).toHaveBeenCalled();
  });

  it("403s someone outside the project", async () => {
    m.project.findUnique.mockResolvedValue({ id: "p1" });
    expect((await rejection(createNotebook({ ...lab, workspaceType: "Project", workspaceId: "p1" }))).status).toBe(403);
    expect(createProjectPage).not.toHaveBeenCalled();
  });

  it("404s a project that does not exist and 400s a project notebook with no project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    m.project.findUnique.mockResolvedValue(null);
    expect((await rejection(createNotebook({ ...lab, workspaceType: "Project", workspaceId: "gone" }))).status).toBe(404);
    expect((await rejection(createNotebook({ ...lab, workspaceType: "Project", workspaceId: null }))).status).toBe(400);
  });

  describe("parent folder", () => {
    const folder = { workspaceType: "Lab", workspaceId: null, kind: "Folder", archivedAt: null };

    it("404s a missing, archived or other-workspace parent", async () => {
      pages({});
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).status).toBe(404);
      pages({ x: { ...folder, archivedAt: new Date() } });
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).status).toBe(404);
      pages({ x: { ...folder, workspaceType: "Project", workspaceId: "p9" } });
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).status).toBe(404);
    });

    it("400s a parent that is not a folder", async () => {
      pages({ x: { ...folder, kind: "Notebook" } });
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).status).toBe(400);
    });

    it("400s when the notebook and a tab would not both fit under the depth cap", async () => {
      pages({ x: folder });
      vi.mocked(pageDepth).mockResolvedValue(5);
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).message).toMatch(/too deeply nested/);
      vi.mocked(pageDepth).mockResolvedValue(4);
      await createNotebook({ ...lab, parentPageId: "x" });
      expect(createLabPage).toHaveBeenCalled();
    });

    it("403s a folder the actor cannot edit", async () => {
      pages({ x: folder });
      access({ x: VIEW_ONLY });
      expect((await rejection(createNotebook({ ...lab, parentPageId: "x" }))).status).toBe(403);
      expect(createLabPage).not.toHaveBeenCalled();
    });
  });

  describe("template", () => {
    const template = { id: "t1", isTemplate: true, archivedAt: null };

    it("records a viewable template on the new notebook", async () => {
      pages({ t1: template });
      await createNotebook({ ...lab, templatePageId: "t1" });
      expect(m.page.update).toHaveBeenCalledWith({ where: { id: "new-nb" }, data: { templatePageId: "t1" } });
    });

    it("rejects a non-template, before creating anything", async () => {
      pages({ t1: { ...template, isTemplate: false } });
      expect((await rejection(createNotebook({ ...lab, templatePageId: "t1" }))).status).toBe(404);
      expect(createLabPage).not.toHaveBeenCalled();
    });
  });
});

describe("getNotebook", () => {
  it("returns the notebook with the tabs the viewer can see", async () => {
    m.page.findUnique.mockResolvedValue({
      ...notebookRow(),
      iconEmoji: null,
      templatePage: { id: "t1", title: "Agenda" },
      seriesUsingAsNotebook: [{ id: "m1", title: "Standup" }],
    });
    m.page.findMany.mockResolvedValue([
      { id: "a", title: "Sep 10", kind: "FreeForm", meetingNoteId: "m1", meetingOccurrenceStart: OCC },
      { id: "b", title: "Secret", kind: "FreeForm", meetingNoteId: null, meetingOccurrenceStart: null },
    ]);
    vi.mocked(getPageAccessBulk).mockResolvedValue(
      new Map([
        ["a", FULL],
        ["b", NONE],
      ]),
    );

    const out = await getNotebook("nb1", "u1");
    expect(out.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(out).toMatchObject({
      id: "nb1",
      canEdit: true,
      templatePage: { id: "t1", title: "Agenda" },
      series: [{ id: "m1", title: "Standup" }],
    });
  });

  it("404s a page that is not a live notebook or that the viewer cannot see", async () => {
    m.page.findUnique.mockResolvedValue({ ...notebookRow({ kind: "FreeForm" }) });
    expect((await rejection(getNotebook("nb1", "u1"))).status).toBe(404);
    m.page.findUnique.mockResolvedValue({ ...notebookRow({ archivedAt: new Date() }) });
    expect((await rejection(getNotebook("nb1", "u1"))).status).toBe(404);
    m.page.findUnique.mockResolvedValue({ ...notebookRow() });
    access({ nb1: NONE });
    expect((await rejection(getNotebook("nb1", "u1"))).status).toBe(404);
  });
});

describe("createBlankNote", () => {
  beforeEach(() => {
    vi.mocked(createNotebookTab).mockResolvedValue({ id: "note9" });
  });

  it("creates an untethered tab titled with today's date and returns its id", async () => {
    pages({ nb1: notebookRow() });

    expect(await createBlankNote("nb1", "u1")).toEqual({ id: "note9" });

    const input = vi.mocked(createNotebookTab).mock.calls[0][0];
    expect(input).toMatchObject({ notebookId: "nb1", createdById: "u1" });
    expect(input.title).toBe(formatDateShort(input.meetingOccurrenceStart));
    expect(input).not.toHaveProperty("meetingNoteId");
    expect(seedPageFromTemplate).not.toHaveBeenCalled();
  });

  it("seeds the tab from the notebook's template", async () => {
    pages({ nb1: notebookRow({ templatePageId: "tpl1" }), tpl1: { isTemplate: true, archivedAt: null } });

    await createBlankNote("nb1", "u1");

    expect(seedPageFromTemplate).toHaveBeenCalledWith("note9", "tpl1");
  });

  it("leaves the tab blank when the template is trashed or no longer a template", async () => {
    pages({ nb1: notebookRow({ templatePageId: "tpl1" }), tpl1: { isTemplate: true, archivedAt: new Date() } });
    await createBlankNote("nb1", "u1");
    pages({ nb1: notebookRow({ templatePageId: "tpl1" }), tpl1: { isTemplate: false, archivedAt: null } });
    await createBlankNote("nb1", "u1");

    expect(seedPageFromTemplate).not.toHaveBeenCalled();
  });

  it("needs edit on the notebook and creates nothing otherwise", async () => {
    pages({ nb1: notebookRow() });
    access({ nb1: VIEW_ONLY });
    expect((await rejection(createBlankNote("nb1", "u1"))).status).toBe(403);
    access({ nb1: NONE });
    expect((await rejection(createBlankNote("nb1", "u1"))).status).toBe(404);
    expect(createNotebookTab).not.toHaveBeenCalled();
  });

  it("404s a trashed notebook", async () => {
    pages({ nb1: notebookRow({ archivedAt: new Date() }) });
    expect((await rejection(createBlankNote("nb1", "u1"))).status).toBe(404);
    expect(createNotebookTab).not.toHaveBeenCalled();
  });
});

describe("setNotebookTemplate", () => {
  const template = { id: "t1", isTemplate: true, archivedAt: null };

  it("sets a template the actor can view", async () => {
    pages({ nb1: notebookRow(), t1: template });
    await setNotebookTemplate("nb1", "t1", "u1");
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "nb1" }, data: { templatePageId: "t1" } });
  });

  it("clears the template with null", async () => {
    pages({ nb1: notebookRow() });
    await setNotebookTemplate("nb1", null, "u1");
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "nb1" }, data: { templatePageId: null } });
  });

  it("403s an actor who cannot edit the notebook, 404s one who cannot see it", async () => {
    pages({ nb1: notebookRow(), t1: template });
    access({ nb1: VIEW_ONLY });
    expect((await rejection(setNotebookTemplate("nb1", "t1", "u1"))).status).toBe(403);
    access({ nb1: NONE });
    expect((await rejection(setNotebookTemplate("nb1", "t1", "u1"))).status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses a page that is not a template, is archived, or is not viewable", async () => {
    pages({ nb1: notebookRow(), t1: { ...template, isTemplate: false } });
    expect((await rejection(setNotebookTemplate("nb1", "t1", "u1"))).status).toBe(404);
    pages({ nb1: notebookRow(), t1: { ...template, archivedAt: new Date() } });
    expect((await rejection(setNotebookTemplate("nb1", "t1", "u1"))).status).toBe(404);
    pages({ nb1: notebookRow(), t1: template });
    access({ t1: NONE });
    expect((await rejection(setNotebookTemplate("nb1", "t1", "u1"))).status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses a trashed notebook and a page that is not a notebook", async () => {
    pages({ nb1: notebookRow({ archivedAt: new Date() }) });
    expect((await rejection(setNotebookTemplate("nb1", null, "u1"))).status).toBe(404);
    pages({ nb1: notebookRow({ kind: "Folder" }) });
    expect((await rejection(setNotebookTemplate("nb1", null, "u1"))).status).toBe(404);
  });
});

describe("addToNotebook", () => {
  beforeEach(() => pages({ nb1: notebookRow(), doc1: docRow() }));

  it("moves a doc into the notebook", async () => {
    await addToNotebook("doc1", "nb1", "u1");
    expect(moveIntoNotebook).toHaveBeenCalledWith("doc1", "nb1");
  });

  it("moves a meeting note without touching its meeting link", async () => {
    pages({ nb1: notebookRow(), doc1: docRow({ meetingNoteId: "m1" }) });
    await addToNotebook("doc1", "nb1", "u1");
    expect(moveIntoNotebook).toHaveBeenCalledWith("doc1", "nb1");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("needs edit on the notebook", async () => {
    access({ nb1: VIEW_ONLY });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(403);
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("needs edit on the page, and hides one the actor cannot see", async () => {
    access({ doc1: VIEW_ONLY });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(403);
    access({ doc1: NONE });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(404);
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("404s a missing or trashed page", async () => {
    pages({ nb1: notebookRow() });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(404);
    pages({ nb1: notebookRow(), doc1: docRow({ archivedAt: new Date() }) });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(404);
  });

  it.each(["Folder", "Whiteboard", "Notebook"])("refuses a %s", async (kind) => {
    pages({ nb1: notebookRow(), doc1: docRow({ kind }) });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(400);
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("refuses a project's Overview and PRD docs", async () => {
    pages({ nb1: notebookRow(), doc1: docRow({ projectAsOverview: { id: "p1" } }) });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(400);
    pages({ nb1: notebookRow(), doc1: docRow({ projectAsPRD: { id: "p1" } }) });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(400);
  });

  it("refuses a course document", async () => {
    pages({ nb1: notebookRow(), doc1: docRow({ workspaceType: "EducationOffering", workspaceId: "o1" }) });
    expect((await rejection(addToNotebook("doc1", "nb1", "u1"))).status).toBe(400);
  });
});

describe("detachNote", () => {
  const note = (over: Record<string, unknown> = {}) =>
    docRow({
      meetingNoteId: "m1",
      parentPageId: "nb1",
      parent: { id: "nb1", kind: "Notebook", parentPageId: "folder1" },
      ...over,
    });

  it("clears both meeting columns together and moves the note to the notebook's folder", async () => {
    pages({ doc1: note() });
    m.page.findFirst.mockResolvedValue({ position: 4 });
    m.page.count.mockResolvedValue(2);

    await detachNote("doc1", "u1");

    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "doc1" },
      data: { meetingNoteId: null, meetingOccurrenceStart: null, parentPageId: "folder1", position: 5, pinnedAt: null },
    });
  });

  it("hands the notebook it left to the abandoned-notebook check", async () => {
    pages({ doc1: note() });

    await detachNote("doc1", "u1");

    expect(trashNotebookIfAbandoned).toHaveBeenCalledWith("nb1");
  });

  it("re-syncs the meeting's shares so the notebook it left stops justifying them", async () => {
    pages({ doc1: note() });
    m.page.count.mockResolvedValue(2);

    await detachNote("doc1", "u1");

    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
  });

  it("goes to the workspace top level when the notebook has no folder", async () => {
    pages({ doc1: note({ parent: { id: "nb1", kind: "Notebook", parentPageId: null } }) });
    m.page.count.mockResolvedValue(1);

    await detachNote("doc1", "u1");

    expect(m.page.update.mock.calls[0][0].data).toMatchObject({ parentPageId: null, position: 0 });
  });

  it("only clears the columns for a note that is not in a notebook", async () => {
    pages({ doc1: note({ parentPageId: "folder1", parent: { id: "folder1", kind: "Folder", parentPageId: null } }) });

    await detachNote("doc1", "u1");

    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "doc1" },
      data: { meetingNoteId: null, meetingOccurrenceStart: null },
    });
    expect(trashNotebookIfAbandoned).not.toHaveBeenCalled();
  });

  it("400s a page that is not a meeting note", async () => {
    pages({ doc1: note({ meetingNoteId: null }) });
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(400);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("needs edit on the page, and on the folder it lands in", async () => {
    pages({ doc1: note() });
    access({ doc1: VIEW_ONLY });
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(403);
    access({ folder1: VIEW_ONLY });
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(403);
    access({ doc1: NONE });
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("404s a missing or trashed page", async () => {
    pages({});
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(404);
    pages({ doc1: note({ archivedAt: new Date() }) });
    expect((await rejection(detachNote("doc1", "u1"))).status).toBe(404);
  });
});

describe("attachNote", () => {
  beforeEach(() => {
    pages({ doc1: docRow({ parentPageId: "folder1" }) });
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
  });

  it("sets both meeting columns to the resolved occurrence and leaves the page in place", async () => {
    expect(await attachNote("doc1", "m1", OCC, "org1")).toEqual({ movedIntoNotebook: false });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "doc1" },
      data: { meetingNoteId: "m1", meetingOccurrenceStart: OCC },
    });
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("syncs the meeting's notebook shares only when the series has a notebook", async () => {
    await attachNote("doc1", "m1", OCC, "org1");
    expect(syncMeetingShares).not.toHaveBeenCalled();

    pages({ doc1: docRow({ parentPageId: "folder1" }), nb1: notebookRow() });
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb1" }));
    await attachNote("doc1", "m1", OCC, "org1");
    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
  });

  it("snaps the requested instant to the occurrence's original start", async () => {
    const snapped = new Date("2026-09-17T15:00:00.000Z");
    vi.mocked(resolveMeetingOccurrence).mockResolvedValue({ originalStart: snapped, start: snapped, end: snapped });
    await attachNote("doc1", "m1", new Date("2026-09-17T15:03:00.000Z"), "org1");
    expect(m.page.update.mock.calls[0][0].data.meetingOccurrenceStart).toEqual(snapped);
  });

  it("409s when the occurrence already has a live note", async () => {
    m.page.findFirst.mockResolvedValue({ id: "other", archivedAt: null });
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(409);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("only counts a live note as holding the occurrence", async () => {
    await attachNote("doc1", "m1", OCC, "org1");
    expect(m.page.findFirst).toHaveBeenCalledWith({
      where: { meetingNoteId: "m1", meetingOccurrenceStart: OCC, archivedAt: null },
      select: { id: true },
    });
  });

  it("frees the slot a trashed note holds, then attaches", async () => {
    const order: string[] = [];
    m.page.updateMany.mockImplementation(async () => {
      order.push("free");
      return { count: 1 };
    });
    m.page.update.mockImplementation(async () => {
      order.push("attach");
      return {};
    });

    await attachNote("doc1", "m1", OCC, "org1");

    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { meetingNoteId: "m1", meetingOccurrenceStart: OCC, archivedAt: { not: null } },
      data: { meetingNoteId: null },
    });
    expect(order).toEqual(["free", "attach"]);
  });

  it("does not free a trashed note's slot when a live note already holds the occurrence", async () => {
    m.page.findFirst.mockResolvedValue({ id: "other" });
    await rejection(attachNote("doc1", "m1", OCC, "org1"));
    expect(m.page.updateMany).not.toHaveBeenCalled();
  });

  it("409s when the unique key loses a race", async () => {
    m.page.update.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(409);
  });

  it("409s a page that is already a meeting note", async () => {
    pages({ doc1: docRow({ meetingNoteId: "m2" }) });
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(409);
  });

  it("moves the page into the series' default notebook when it is elsewhere", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb1" }));
    pages({ doc1: docRow({ parentPageId: "folder1" }), nb1: notebookRow() });

    expect(await attachNote("doc1", "m1", OCC, "org1")).toEqual({ movedIntoNotebook: true });
    expect(moveIntoNotebook).toHaveBeenCalledWith("doc1", "nb1");
  });

  it("leaves a page already in the default notebook alone", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb1" }));
    pages({ doc1: docRow({ parentPageId: "nb1" }) });

    expect(await attachNote("doc1", "m1", OCC, "org1")).toEqual({ movedIntoNotebook: false });
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("still attaches when the actor cannot edit the default notebook", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ notebookId: "nb1" }));
    pages({ doc1: docRow({ parentPageId: "folder1" }), nb1: notebookRow() });
    access({ nb1: VIEW_ONLY });

    expect(await attachNote("doc1", "m1", OCC, "org1")).toEqual({ movedIntoNotebook: false });
    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("needs the organizer or Core on the meeting", async () => {
    expect((await rejection(attachNote("doc1", "m1", OCC, "stranger"))).status).toBe(403);
    vi.mocked(isCore).mockResolvedValue(true);
    await attachNote("doc1", "m1", OCC, "core1");
    expect(m.page.update).toHaveBeenCalledTimes(1);
  });

  it("needs edit on the page", async () => {
    access({ doc1: VIEW_ONLY });
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(403);
    access({ doc1: NONE });
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(404);
  });

  it("404s a missing or cancelled meeting", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(null);
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(404);
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ status: "Cancelled" }));
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(404);
  });

  it("only attaches documents", async () => {
    pages({ doc1: docRow({ kind: "Whiteboard" }) });
    expect((await rejection(attachNote("doc1", "m1", OCC, "org1"))).status).toBe(400);
  });
});

describe("setSeriesNotebook", () => {
  beforeEach(() => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow());
    pages({ nb1: notebookRow(), a: docRow({ id: "a", parentPageId: "x" }), b: docRow({ id: "b", parentPageId: "nb1" }) });
  });

  it("future only sets the default and moves nothing", async () => {
    expect(await setSeriesNotebook("m1", "nb1", { scope: "future" }, "org1")).toEqual({ moved: 0, skipped: 0 });
    expect(m.scheduledMeeting.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { notebookId: "nb1" } });
    expect(m.page.findMany).not.toHaveBeenCalled();
    expect(moveIntoNotebook).not.toHaveBeenCalled();
  });

  it("syncs the meeting's shares for a new notebook and for unsetting it", async () => {
    await setSeriesNotebook("m1", "nb1", { scope: "future" }, "org1");
    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
    vi.mocked(syncMeetingShares).mockClear();
    await setSeriesNotebook("m1", null, { scope: "future" }, "org1");
    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
  });

  it("all also moves every live note that is not already in the notebook", async () => {
    m.page.findMany.mockResolvedValue([
      { id: "a", parentPageId: "x" },
      { id: "b", parentPageId: "nb1" },
    ]);

    expect(await setSeriesNotebook("m1", "nb1", { scope: "all" }, "org1")).toEqual({ moved: 1, skipped: 0 });
    expect(m.page.findMany).toHaveBeenCalledWith({
      where: { meetingNoteId: "m1", archivedAt: null },
      select: { id: true, parentPageId: true },
    });
    expect(moveIntoNotebook).toHaveBeenCalledTimes(1);
    expect(moveIntoNotebook).toHaveBeenCalledWith("a", "nb1");
  });

  it("all skips a note the actor cannot edit and keeps going", async () => {
    pages({
      nb1: notebookRow(),
      a: docRow({ id: "a", parentPageId: "x" }),
      c: docRow({ id: "c", parentPageId: "x" }),
    });
    access({ a: VIEW_ONLY });
    m.page.findMany.mockResolvedValue([
      { id: "a", parentPageId: "x" },
      { id: "c", parentPageId: "x" },
    ]);

    expect(await setSeriesNotebook("m1", "nb1", { scope: "all" }, "org1")).toEqual({ moved: 1, skipped: 1 });
    expect(moveIntoNotebook).toHaveBeenCalledWith("c", "nb1");
  });

  it("unsets the default with null, and moves nothing even for all", async () => {
    await setSeriesNotebook("m1", null, { scope: "all" }, "org1");
    expect(m.scheduledMeeting.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { notebookId: null } });
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("needs the organizer or Core", async () => {
    expect((await rejection(setSeriesNotebook("m1", "nb1", { scope: "future" }, "stranger"))).status).toBe(403);
    expect(m.scheduledMeeting.update).not.toHaveBeenCalled();
    vi.mocked(isCore).mockResolvedValue(true);
    await setSeriesNotebook("m1", "nb1", { scope: "future" }, "core1");
    expect(m.scheduledMeeting.update).toHaveBeenCalled();
  });

  it("needs edit on the notebook, before changing anything", async () => {
    access({ nb1: VIEW_ONLY });
    expect((await rejection(setSeriesNotebook("m1", "nb1", { scope: "all" }, "org1"))).status).toBe(403);
    expect(m.scheduledMeeting.update).not.toHaveBeenCalled();
  });

  it("404s a missing or cancelled meeting", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(null);
    expect((await rejection(setSeriesNotebook("m1", "nb1", { scope: "future" }, "org1"))).status).toBe(404);
    m.scheduledMeeting.findUnique.mockResolvedValue(meetingRow({ status: "Cancelled" }));
    expect((await rejection(setSeriesNotebook("m1", "nb1", { scope: "future" }, "org1"))).status).toBe(404);
  });
});

describe("mergeNotebooks", () => {
  beforeEach(() => pages({ src: notebookRow({ id: "src" }), dst: notebookRow({ id: "dst" }) }));

  it("moves every live tab, repoints the series and retires the source", async () => {
    m.page.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);

    expect(await mergeNotebooks("src", "dst", "u1")).toEqual({ moved: 2 });

    expect(m.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentPageId: "src", archivedAt: null } }),
    );
    expect(moveIntoNotebook).toHaveBeenNthCalledWith(1, "t1", "dst");
    expect(moveIntoNotebook).toHaveBeenNthCalledWith(2, "t2", "dst");
    expect(m.scheduledMeeting.updateMany).toHaveBeenCalledWith({
      where: { notebookId: "src" },
      data: { notebookId: "dst" },
    });
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "src" }, data: { archivedAt: expect.any(Date) } });
  });

  it("syncs shares for every series that moved", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    await mergeNotebooks("src", "dst", "u1");
    expect(m.scheduledMeeting.findMany).toHaveBeenCalledWith({ where: { notebookId: "src" }, select: { id: true } });
    expect(syncMeetingShares).toHaveBeenCalledWith("m1");
    expect(syncMeetingShares).toHaveBeenCalledWith("m2");
  });

  it("frees a legacy auto-grouping key when it retires the source", async () => {
    pages({ src: notebookRow({ id: "src", notebookKey: "project:p1:Team" }), dst: notebookRow({ id: "dst" }) });
    await mergeNotebooks("src", "dst", "u1");
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "src" },
      data: { archivedAt: expect.any(Date), notebookKey: "project:p1:Team#src" },
    });
  });

  it("retires an empty source too", async () => {
    expect(await mergeNotebooks("src", "dst", "u1")).toEqual({ moved: 0 });
    expect(moveIntoNotebook).not.toHaveBeenCalled();
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "src" }, data: { archivedAt: expect.any(Date) } });
  });

  it("refuses to merge a notebook into itself", async () => {
    expect((await rejection(mergeNotebooks("src", "src", "u1"))).status).toBe(400);
  });

  it("needs edit on both notebooks and touches nothing otherwise", async () => {
    access({ dst: VIEW_ONLY });
    expect((await rejection(mergeNotebooks("src", "dst", "u1"))).status).toBe(403);
    access({ src: VIEW_ONLY });
    expect((await rejection(mergeNotebooks("src", "dst", "u1"))).status).toBe(403);
    expect(moveIntoNotebook).not.toHaveBeenCalled();
    expect(m.scheduledMeeting.updateMany).not.toHaveBeenCalled();
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("404s when either side is not a live notebook", async () => {
    pages({ src: notebookRow({ id: "src" }), dst: notebookRow({ id: "dst", archivedAt: new Date() }) });
    expect((await rejection(mergeNotebooks("src", "dst", "u1"))).status).toBe(404);
  });
});

describe("dissolveNotebook", () => {
  beforeEach(() => pages({ nb1: notebookRow() }));

  it("moves each tab to the notebook's folder as a plain doc that keeps its meeting link", async () => {
    m.page.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    m.page.findFirst.mockResolvedValue({ position: 9 });

    expect(await dissolveNotebook("nb1", "u1")).toEqual({ moved: 2 });

    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { parentPageId: "folder1", position: 10, pinnedAt: null },
    });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "t2" },
      data: { parentPageId: "folder1", position: 11, pinnedAt: null },
    });
    for (const [arg] of m.page.update.mock.calls) {
      expect(arg.data).not.toHaveProperty("meetingNoteId");
      expect(arg.data).not.toHaveProperty("meetingOccurrenceStart");
    }
  });

  it("clears the series that used it and archives the notebook", async () => {
    await dissolveNotebook("nb1", "u1");
    expect(m.scheduledMeeting.updateMany).toHaveBeenCalledWith({
      where: { notebookId: "nb1" },
      data: { notebookId: null },
    });
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "nb1" }, data: { archivedAt: expect.any(Date) } });
  });

  it("removes the shares of every series that used it", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    await dissolveNotebook("nb1", "u1");
    expect(removeMeetingShares).toHaveBeenCalledWith("m1");
    expect(removeMeetingShares).toHaveBeenCalledWith("m2");
  });

  it("frees a legacy auto-grouping key", async () => {
    pages({ nb1: notebookRow({ notebookKey: "general:users:a" }) });
    await dissolveNotebook("nb1", "u1");
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "nb1" },
      data: { archivedAt: expect.any(Date), notebookKey: "general:users:a#nb1" },
    });
  });

  it("needs edit on the notebook and on its folder", async () => {
    access({ nb1: VIEW_ONLY });
    expect((await rejection(dissolveNotebook("nb1", "u1"))).status).toBe(403);
    access({ folder1: VIEW_ONLY });
    expect((await rejection(dissolveNotebook("nb1", "u1"))).status).toBe(403);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("needs no folder check at the top level", async () => {
    pages({ nb1: notebookRow({ parentPageId: null }) });
    access({ folder1: NONE });
    await dissolveNotebook("nb1", "u1");
    expect(m.$transaction).toHaveBeenCalled();
  });
});

describe("trashNotebook", () => {
  beforeEach(() => pages({ nb1: notebookRow() }));

  it("archives the notebook and its live subtree at one instant, and keeps the series pointing at it", async () => {
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["t1", "t2"], height: 1 });

    await trashNotebook("nb1", "u1");

    expect(collectSubtree).toHaveBeenCalledWith("nb1");
    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["nb1", "t1", "t2"] }, archivedAt: null },
      data: { archivedAt: expect.any(Date) },
    });
    expect(m.scheduledMeeting.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the shares of every series that used it, so a restore needs no re-sharing", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([{ id: "m1" }]);
    await trashNotebook("nb1", "u1");
    expect(removeMeetingShares).not.toHaveBeenCalled();
  });

  it("needs edit on the notebook", async () => {
    access({ nb1: VIEW_ONLY });
    expect((await rejection(trashNotebook("nb1", "u1"))).status).toBe(403);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("404s a page that is not a live notebook", async () => {
    pages({ nb1: notebookRow({ kind: "Folder" }) });
    expect((await rejection(trashNotebook("nb1", "u1"))).status).toBe(404);
  });
});

describe("canManageNotebook", () => {
  const nb = (over: Record<string, unknown> = {}) => notebookRow({ createdById: "creator", ...over });
  const shareOnlyEditor = () =>
    vi.mocked(getPageAccess).mockImplementation((async (_u: string, _p: any, _r: any, options: any) =>
      options?.ignoreShares ? VIEW_ONLY : FULL) as never);

  it("is true when the actor can edit ignoring shares", async () => {
    expect(await canManageNotebook("u1", nb())).toBe(true);
    expect(getPageAccess).toHaveBeenCalledWith("u1", expect.objectContaining({ id: "nb1" }), undefined, {
      ignoreShares: true,
    });
    expect(m.scheduledMeeting.findFirst).not.toHaveBeenCalled();
  });

  it("is false for an editor who only has a share", async () => {
    shareOnlyEditor();
    m.scheduledMeeting.findFirst.mockResolvedValue(null);
    expect(await canManageNotebook("u1", nb())).toBe(false);
    expect(m.scheduledMeeting.findFirst).toHaveBeenCalledWith({
      where: { notebookId: "nb1", organizerId: "u1" },
      select: { id: true },
    });
  });

  it("is true for the organizer of a meeting that files there", async () => {
    shareOnlyEditor();
    m.scheduledMeeting.findFirst.mockResolvedValue({ id: "m1" });
    expect(await canManageNotebook("u1", nb())).toBe(true);
  });

  it("is true for the notebook's creator", async () => {
    shareOnlyEditor();
    expect(await canManageNotebook("creator", nb())).toBe(true);
    expect(m.scheduledMeeting.findFirst).not.toHaveBeenCalled();
  });
});

describe("structure mutations need manage authority", () => {
  const shareOnlyEditor = () => {
    vi.mocked(getPageAccess).mockImplementation((async (_u: string, _p: any, _r: any, options: any) =>
      options?.ignoreShares ? VIEW_ONLY : FULL) as never);
    m.scheduledMeeting.findFirst.mockResolvedValue(null);
  };
  const note = docRow({
    meetingNoteId: "m1",
    parentPageId: "nb1",
    parent: { ...notebookRow(), parentPageId: "folder1" },
  });
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["setNotebookTemplate", () => setNotebookTemplate("nb1", null, "u1")],
    ["mergeNotebooks", () => mergeNotebooks("nb1", "nb2", "u1")],
    ["dissolveNotebook", () => dissolveNotebook("nb1", "u1")],
    ["trashNotebook", () => trashNotebook("nb1", "u1")],
    ["detachNote", () => detachNote("doc1", "u1")],
  ];

  beforeEach(() => {
    pages({ nb1: notebookRow(), nb2: notebookRow({ id: "nb2" }), doc1: note });
    m.page.findFirst.mockResolvedValue({ position: 1 });
    m.page.count.mockResolvedValue(1);
  });

  it.each(cases)("%s 403s a share-only editor", async (_name, run) => {
    shareOnlyEditor();
    const err = await rejection(run());
    expect(err.status).toBe(403);
    expect(getPageAccess).toHaveBeenCalledWith("u1", expect.objectContaining({ id: "nb1" }), undefined, {
      ignoreShares: true,
    });
    expect(m.page.update).not.toHaveBeenCalled();
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it.each(cases)("%s succeeds for a manager", async (_name, run) => {
    await expect(run()).resolves.not.toThrow();
  });

  it("lets the organizer of a meeting filing there restructure", async () => {
    shareOnlyEditor();
    m.scheduledMeeting.findFirst.mockResolvedValue({ id: "m1" });
    await expect(trashNotebook("nb1", "u1")).resolves.toBeUndefined();
  });

  it("detaches a note that sits outside any notebook with plain edit", async () => {
    shareOnlyEditor();
    pages({ doc1: docRow({ meetingNoteId: "m1", parent: null }) });
    await expect(detachNote("doc1", "u1")).resolves.toBeUndefined();
  });

  it("still lets a share-only editor add a tab", async () => {
    shareOnlyEditor();
    pages({ nb1: notebookRow(), doc1: docRow() });
    await expect(addToNotebook("doc1", "nb1", "u1")).resolves.toBeUndefined();
    expect(moveIntoNotebook).toHaveBeenCalledWith("doc1", "nb1");
  });
});
