import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => (u ? `resolved:${u}` : null)) }));
vi.mock("~/collab/export", () => ({
  collabDocToHtml: vi.fn(async (room: string) => `<p>${room}</p>`),
}));
vi.mock("~/collab/read", () => ({
  readDocAsBlocks: vi.fn(async (room: string) => [{ id: "b1", type: "callout", room }]),
}));
vi.mock("../announcements.server", () => ({ listDiscussion: vi.fn(async () => ["ann"]) }));
vi.mock("../assignments.server", () => ({ listAssignments: vi.fn() }));
vi.mock("../discussions.server", () => ({
  listThreads: vi.fn(async () => ["thread"]),
  offeringInstructorIds: vi.fn(async () => new Set(["ins-1"])),
}));
vi.mock("../student-notes.server", () => ({ studentVisibleFeedback: vi.fn(async () => ({ feedback: "ok" })) }));
vi.mock("../session-checkin.server", () => ({
  isSessionCheckInOpen: (s: { checkInOpenAt: Date | null }) => s.checkInOpenAt != null,
}));

import { prisma } from "~/lib/db.server";
import { readDocAsBlocks } from "~/collab/read";
import { listAssignments } from "../assignments.server";
import { studentVisibleFeedback } from "../student-notes.server";
import {
  listMaterialPages,
  listWorkspaceDocs,
  listOfferingFiles,
  readMaterialPage,
  createMaterialPage,
  moveMaterialPage,
  moveMaterialFile,
  renameMaterialPage,
  renameMaterialFile,
  archiveMaterialPage,
  archiveMaterialFile,
  getStudentDashboard,
  listSessionsWithMyAttendance,
  getHubData,
} from "../lms.server";

type M = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as M;

const inOffering = (extra: object = {}) => ({
  workspaceType: "EducationOffering",
  workspaceId: "off-1",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) {
    for (const fn of Object.values(model)) fn.mockReset?.();
  }
  db.page.findMany.mockResolvedValue([]);
  db.projectFile.findMany.mockResolvedValue([]);
  db.page.count.mockResolvedValue(0);
  db.projectFile.count.mockResolvedValue(0);
});

describe("listMaterialPages", () => {
  it("queries only live, non-workspace pages of the offering in position order", async () => {
    await listMaterialPages("off-1");
    const arg = db.page.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      workspaceType: "EducationOffering",
      workspaceId: "off-1",
      archivedAt: null,
      studentEditable: false,
    });
    expect(arg.orderBy).toEqual([{ position: "asc" }]);
  });

  it("nests children under their parent and flags folders", async () => {
    const d = new Date();
    db.page.findMany.mockResolvedValue([
      { id: "f", title: "Week 1", kind: "Folder", parentPageId: null, updatedAt: d, sessionId: null },
      { id: "c1", title: "Slides", kind: "FreeForm", parentPageId: "f", updatedAt: d, sessionId: "s1" },
      { id: "top", title: "Syllabus", kind: "FreeForm", parentPageId: null, updatedAt: d, sessionId: null },
    ]);
    const out = await listMaterialPages("off-1");
    expect(out.map((p) => [p.id, p.isFolder])).toEqual([
      ["f", true],
      ["top", false],
    ]);
    expect(out[0].children).toEqual([{ id: "c1", title: "Slides", sessionId: "s1", updatedAt: d }]);
    expect(out[1].children).toEqual([]);
  });
});

describe("listWorkspaceDocs / listOfferingFiles", () => {
  it("workspace docs are only studentEditable, unarchived pages of the offering", async () => {
    await listWorkspaceDocs("off-1");
    expect(db.page.findMany.mock.calls[0][0].where).toEqual({
      workspaceType: "EducationOffering",
      workspaceId: "off-1",
      archivedAt: null,
      studentEditable: true,
    });
  });

  it("files get a Drive viewer href and unarchived filter", async () => {
    db.projectFile.findMany.mockResolvedValue([{ id: "f1", title: "Reading.pdf", sessionId: null }]);
    const out = await listOfferingFiles("off-1");
    expect(out).toEqual([{ id: "f1", title: "Reading.pdf", sessionId: null, href: "/documents/file/f1" }]);
    expect(db.projectFile.findMany.mock.calls[0][0].where.archivedAt).toBeNull();
  });
});

describe("readMaterialPage", () => {
  it.each([
    ["missing", null],
    ["archived", inOffering({ id: "p", title: "t", archivedAt: new Date(), studentEditable: false })],
    ["in another workspace type", { ...inOffering(), workspaceType: "Project", id: "p", title: "t", archivedAt: null }],
    ["in another offering", { ...inOffering({ workspaceId: "off-2" }), id: "p", title: "t", archivedAt: null }],
  ])("returns null for a page that is %s and never reads the doc", async (_n, page) => {
    db.page.findUnique.mockResolvedValue(page);
    expect(await readMaterialPage("off-1", "p")).toBeNull();
    expect(readDocAsBlocks).not.toHaveBeenCalled();
  });

  it("returns the blocks from the body room unchanged", async () => {
    db.page.findUnique.mockResolvedValue(
      inOffering({ id: "p1", title: "Syllabus", archivedAt: null, studentEditable: false }),
    );
    expect(await readMaterialPage("off-1", "p1")).toEqual({
      id: "p1",
      title: "Syllabus",
      studentEditable: false,
      content: [{ id: "b1", type: "callout", room: "doc:p1:body" }],
    });
  });

  it("skips the read for a shared doc when asked", async () => {
    db.page.findUnique.mockResolvedValue(
      inOffering({ id: "p1", title: "Notes", archivedAt: null, studentEditable: true }),
    );
    const out = await readMaterialPage("off-1", "p1", { skipShared: true });
    expect(out?.content).toBeNull();
    expect(readDocAsBlocks).not.toHaveBeenCalled();
  });

  it("still reads a shared doc by default", async () => {
    db.page.findUnique.mockResolvedValue(
      inOffering({ id: "p1", title: "Notes", archivedAt: null, studentEditable: true }),
    );
    const out = await readMaterialPage("off-1", "p1");
    expect(out?.content).toEqual([{ id: "b1", type: "callout", room: "doc:p1:body" }]);
  });
});

describe("createMaterialPage", () => {
  const base = { offeringId: "off-1", title: "  Notes  ", actorId: "u1" };

  it("rejects a blank title", async () => {
    expect(await createMaterialPage({ ...base, title: "   " })).toEqual({ error: "Title is required", status: 400 });
    expect(db.page.create).not.toHaveBeenCalled();
  });

  it("rejects a nested folder", async () => {
    expect(await createMaterialPage({ ...base, kind: "Folder", parentPageId: "p" })).toEqual({
      error: "Folders can't be nested",
      status: 400,
    });
  });

  it("404s when the parent is missing or in another offering", async () => {
    db.page.findUnique.mockResolvedValueOnce(null);
    expect(await createMaterialPage({ ...base, parentPageId: "p" })).toEqual({ error: "Parent page not found", status: 404 });
    db.page.findUnique.mockResolvedValueOnce({ ...inOffering({ workspaceId: "off-2" }), parentPageId: null });
    expect(await createMaterialPage({ ...base, parentPageId: "p" })).toMatchObject({ status: 404 });
    expect(db.page.create).not.toHaveBeenCalled();
  });

  it("rejects nesting more than one level deep", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering(), parentPageId: "grandparent" });
    expect(await createMaterialPage({ ...base, parentPageId: "p" })).toEqual({
      error: "Pages only nest one level deep",
      status: 400,
    });
  });

  it("404s when the session belongs to another offering", async () => {
    db.page.findFirst.mockResolvedValue(null);
    db.educationSession.findUnique.mockResolvedValue({ offeringId: "off-2" });
    expect(await createMaterialPage({ ...base, sessionId: "s" })).toEqual({ error: "Session not found", status: 404 });
    expect(db.page.create).not.toHaveBeenCalled();
  });

  it("appends after the last sibling with trimmed title and defaults", async () => {
    db.page.findFirst.mockResolvedValue({ position: 4 });
    db.page.create.mockResolvedValue({ id: "new" });
    expect(await createMaterialPage(base)).toEqual({ id: "new" });
    expect(db.page.findFirst.mock.calls[0][0].where.parentPageId).toBeNull();
    expect(db.page.create.mock.calls[0][0].data).toEqual({
      workspaceType: "EducationOffering",
      workspaceId: "off-1",
      title: "Notes",
      kind: "FreeForm",
      parentPageId: null,
      position: 5,
      studentEditable: false,
      createdById: "u1",
      sessionId: null,
    });
  });

  it("starts at position 0 in an empty level and passes through parent, kind, session", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering(), parentPageId: null });
    db.page.findFirst.mockResolvedValue(null);
    db.educationSession.findUnique.mockResolvedValue({ offeringId: "off-1" });
    db.page.create.mockResolvedValue({ id: "new" });
    await createMaterialPage({ ...base, parentPageId: "folder", sessionId: "s1", studentEditable: true });
    expect(db.page.findFirst.mock.calls[0][0].where.parentPageId).toBe("folder");
    expect(db.page.create.mock.calls[0][0].data).toMatchObject({
      position: 0,
      parentPageId: "folder",
      sessionId: "s1",
      studentEditable: true,
    });
  });
});

describe("moveMaterialPage", () => {
  const args = { offeringId: "off-1", pageId: "p", parentPageId: "f", actorId: "u" };

  it("404s for a page outside the offering", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering({ workspaceId: "off-2" }), kind: "FreeForm" });
    expect(await moveMaterialPage(args)).toEqual({ error: "Page not found", status: 404 });
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("refuses to move a folder", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering(), kind: "Folder" });
    expect(await moveMaterialPage(args)).toEqual({ error: "Folders stay at the top level", status: 400 });
  });

  it("404s when the destination is missing or in another offering", async () => {
    db.page.findUnique
      .mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" })
      .mockResolvedValueOnce({ ...inOffering({ workspaceId: "off-2" }), kind: "Folder" });
    expect(await moveMaterialPage(args)).toEqual({ error: "Folder not found", status: 404 });
  });

  it("only nests into folders", async () => {
    db.page.findUnique
      .mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" })
      .mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" });
    expect(await moveMaterialPage(args)).toEqual({ error: "Materials only nest in folders", status: 400 });
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("sets the parent to the folder, or null to return to top level", async () => {
    db.page.findUnique
      .mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" })
      .mockResolvedValueOnce({ ...inOffering(), kind: "Folder" });
    expect(await moveMaterialPage(args)).toEqual({ ok: true });
    expect(db.page.update).toHaveBeenLastCalledWith({ where: { id: "p" }, data: { parentPageId: "f" } });

    db.page.findUnique.mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" });
    await moveMaterialPage({ ...args, parentPageId: null });
    expect(db.page.update).toHaveBeenLastCalledWith({ where: { id: "p" }, data: { parentPageId: null } });
  });
});

describe("moveMaterialFile", () => {
  const args = { offeringId: "off-1", fileId: "f", folderId: "fo", actorId: "u" };

  it("404s for a file outside the offering", async () => {
    db.projectFile.findUnique.mockResolvedValue(inOffering({ workspaceId: "off-2" }));
    expect(await moveMaterialFile(args)).toEqual({ error: "File not found", status: 404 });
  });

  it("404s for a foreign folder and 400s for a non-folder page", async () => {
    db.projectFile.findUnique.mockResolvedValue(inOffering());
    db.page.findUnique.mockResolvedValueOnce({ ...inOffering({ workspaceId: "off-2" }), kind: "Folder" });
    expect(await moveMaterialFile(args)).toEqual({ error: "Folder not found", status: 404 });
    db.page.findUnique.mockResolvedValueOnce({ ...inOffering(), kind: "FreeForm" });
    expect(await moveMaterialFile(args)).toEqual({ error: "Files only nest in folders", status: 400 });
    expect(db.projectFile.update).not.toHaveBeenCalled();
  });

  it("files into the folder, or back to the root with null", async () => {
    db.projectFile.findUnique.mockResolvedValue(inOffering());
    db.page.findUnique.mockResolvedValue({ ...inOffering(), kind: "Folder" });
    expect(await moveMaterialFile(args)).toEqual({ ok: true });
    expect(db.projectFile.update).toHaveBeenLastCalledWith({ where: { id: "f" }, data: { folderPageId: "fo" } });
    await moveMaterialFile({ ...args, folderId: null });
    expect(db.projectFile.update).toHaveBeenLastCalledWith({ where: { id: "f" }, data: { folderPageId: null } });
  });
});

describe("renameMaterialPage / renameMaterialFile", () => {
  it("reject blank titles before touching the db", async () => {
    expect(await renameMaterialPage({ offeringId: "off-1", pageId: "p", title: " ", actorId: "u" })).toMatchObject({ status: 400 });
    expect(await renameMaterialFile({ offeringId: "off-1", fileId: "f", title: "", actorId: "u" })).toMatchObject({ status: 400 });
    expect(db.page.findUnique).not.toHaveBeenCalled();
    expect(db.projectFile.findUnique).not.toHaveBeenCalled();
  });

  it("404 for items outside the offering", async () => {
    db.page.findUnique.mockResolvedValue(inOffering({ workspaceId: "off-2" }));
    db.projectFile.findUnique.mockResolvedValue(null);
    expect(await renameMaterialPage({ offeringId: "off-1", pageId: "p", title: "x", actorId: "u" })).toEqual({ error: "Page not found", status: 404 });
    expect(await renameMaterialFile({ offeringId: "off-1", fileId: "f", title: "x", actorId: "u" })).toEqual({ error: "File not found", status: 404 });
    expect(db.page.update).not.toHaveBeenCalled();
    expect(db.projectFile.update).not.toHaveBeenCalled();
  });

  it("writes the trimmed title, stamping the page editor", async () => {
    db.page.findUnique.mockResolvedValue(inOffering());
    db.projectFile.findUnique.mockResolvedValue(inOffering());
    await renameMaterialPage({ offeringId: "off-1", pageId: "p", title: "  New  ", actorId: "u9" });
    expect(db.page.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { title: "New", lastEditedById: "u9" } });
    await renameMaterialFile({ offeringId: "off-1", fileId: "f", title: " Doc ", actorId: "u9" });
    expect(db.projectFile.update).toHaveBeenCalledWith({ where: { id: "f" }, data: { title: "Doc" } });
  });
});

describe("archiveMaterialPage / archiveMaterialFile", () => {
  const pArgs = { offeringId: "off-1", pageId: "p", actorId: "u" };

  it("404s outside the offering", async () => {
    db.page.findUnique.mockResolvedValue(inOffering({ workspaceId: "off-2" }));
    expect(await archiveMaterialPage(pArgs)).toEqual({ error: "Page not found", status: 404 });
    db.projectFile.findUnique.mockResolvedValue(null);
    expect(await archiveMaterialFile({ offeringId: "off-1", fileId: "f", actorId: "u" })).toEqual({ error: "File not found", status: 404 });
  });

  it("refuses to archive a folder still holding pages or files", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering(), kind: "Folder" });
    db.page.count.mockResolvedValue(0);
    db.projectFile.count.mockResolvedValue(1);
    expect(await archiveMaterialPage(pArgs)).toMatchObject({ status: 400 });
    expect(db.page.count.mock.calls[0][0].where).toEqual({ parentPageId: "p", archivedAt: null });
    expect(db.projectFile.count.mock.calls[0][0].where).toEqual({ folderPageId: "p", archivedAt: null });
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("soft-archives an empty folder and a plain page without counting children", async () => {
    db.page.findUnique.mockResolvedValue({ ...inOffering(), kind: "Folder" });
    expect(await archiveMaterialPage(pArgs)).toEqual({ ok: true });
    expect(db.page.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);

    db.page.count.mockClear();
    db.page.findUnique.mockResolvedValue({ ...inOffering(), kind: "FreeForm" });
    await archiveMaterialPage(pArgs);
    expect(db.page.count).not.toHaveBeenCalled();
  });

  it("soft-archives a file", async () => {
    db.projectFile.findUnique.mockResolvedValue(inOffering());
    expect(await archiveMaterialFile({ offeringId: "off-1", fileId: "f", actorId: "u" })).toEqual({ ok: true });
    expect(db.projectFile.update.mock.calls[0][0].where).toEqual({ id: "f" });
    expect(db.projectFile.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("getStudentDashboard", () => {
  const DAY = 86_400_000;
  const past = new Date(Date.now() - 2 * DAY);
  const future = new Date(Date.now() + 2 * DAY);
  const mkOffering = (over: object = {}) => ({
    id: "o1",
    title: "Intro",
    type: "Course",
    status: "Active",
    endsAt: null,
    closedOutAt: null,
    sessions: [
      { id: "s1", sequence: 1, title: "Kickoff", datetime: past, endsAt: past, checkInOpenAt: null },
      { id: "s2", sequence: 2, title: null, datetime: future, endsAt: future, checkInOpenAt: new Date() },
    ],
    ...over,
  });

  it("only looks up Approved applications for the user", async () => {
    db.educationApplication.findMany.mockResolvedValue([]);
    const out = await getStudentDashboard("u1");
    expect(db.educationApplication.findMany.mock.calls[0][0].where).toEqual({ applicantUserId: "u1", status: "Approved" });
    expect(out).toEqual({ openCheckIns: [], dueSoon: [], myCourses: [] });
    expect(db.educationAssignment.findMany).not.toHaveBeenCalled();
  });

  it("drops pulled (archived, never closed out) courses but keeps closed-out ones as past", async () => {
    db.educationApplication.findMany.mockResolvedValue([
      { offeringId: "o1", offering: mkOffering({ status: "Archived" }), attendances: [] },
      { offeringId: "o2", offering: mkOffering({ id: "o2", status: "Archived", closedOutAt: past }), attendances: [] },
    ]);
    db.educationAssignment.findMany.mockResolvedValue([]);
    const out = await getStudentDashboard("u1");
    expect(out.myCourses.map((c) => [c.offeringId, c.isPast])).toEqual([["o2", true]]);
  });

  it("reports attendance against held sessions and the next upcoming session", async () => {
    db.educationApplication.findMany.mockResolvedValue([
      { offeringId: "o1", offering: mkOffering(), attendances: [{ sessionId: "s1", status: "Present" }] },
    ]);
    db.educationAssignment.findMany.mockResolvedValue([]);
    const out = await getStudentDashboard("u1");
    expect(out.myCourses[0]).toMatchObject({ attended: 1, held: 1, total: 2, nextSessionAt: future, isPast: false });
  });

  it("marks a course past when its end date has passed", async () => {
    db.educationApplication.findMany.mockResolvedValue([
      { offeringId: "o1", offering: mkOffering({ endsAt: past }), attendances: [] },
    ]);
    db.educationAssignment.findMany.mockResolvedValue([]);
    expect((await getStudentDashboard("u1")).myCourses[0].isPast).toBe(true);
  });

  it("lists open check-ins for sessions the student has not already attended", async () => {
    const off = mkOffering({
      sessions: [
        { id: "s2", sequence: 2, title: null, datetime: future, endsAt: null, checkInOpenAt: new Date() },
        { id: "s3", sequence: 3, title: "Demo", datetime: future, endsAt: null, checkInOpenAt: new Date() },
        { id: "s4", sequence: 4, title: "Closed", datetime: future, endsAt: null, checkInOpenAt: null },
      ],
    });
    db.educationApplication.findMany.mockResolvedValue([
      { offeringId: "o1", offering: off, attendances: [{ sessionId: "s3", status: "Present" }] },
    ]);
    db.educationAssignment.findMany.mockResolvedValue([]);
    const out = await getStudentDashboard("u1");
    expect(out.openCheckIns.map((c) => [c.sessionId, c.sessionLabel, c.offeringTitle])).toEqual([
      ["s2", "Session 2", "Intro"],
    ]);
  });

  it("lists unsubmitted assignments soonest-due first, nulls last, resolving session-scoped ones", async () => {
    db.educationApplication.findMany.mockResolvedValue([
      { offeringId: "o1", offering: mkOffering(), attendances: [] },
    ]);
    const soon = new Date(Date.now() + DAY);
    db.educationAssignment.findMany.mockResolvedValue([
      { id: "a-none", title: "No due", dueAt: null, offeringId: "o1", session: null },
      { id: "a-late", title: "Later", dueAt: future, offeringId: null, session: { offeringId: "o1" } },
      { id: "a-soon", title: "Soon", dueAt: soon, offeringId: "o1", session: null },
      { id: "a-done", title: "Done", dueAt: soon, offeringId: "o1", session: null },
      { id: "a-draft", title: "Draft only", dueAt: soon, offeringId: "o1", session: null },
      { id: "a-orphan", title: "Orphan", dueAt: soon, offeringId: null, session: null },
    ]);
    db.educationSubmission.findMany.mockResolvedValue([
      { assignmentId: "a-done", submittedAt: new Date() },
      { assignmentId: "a-draft", submittedAt: null },
    ]);
    const out = await getStudentDashboard("u1");
    expect(out.dueSoon.map((d) => d.assignmentId)).toEqual(["a-soon", "a-draft", "a-late", "a-none"]);
    expect(out.dueSoon.every((d) => d.offeringTitle === "Intro")).toBe(true);
    const subWhere = db.educationSubmission.findMany.mock.calls[0][0].where;
    expect(subWhere.studentId).toBe("u1");
  });
});

describe("listSessionsWithMyAttendance", () => {
  const row = (id: string, open: Date | null) => ({
    id, sequence: 1, title: null, datetime: new Date(), endsAt: null, location: null, notes: null,
    recordingUrl: null, checkInOpenAt: open,
  });

  it("never exposes the raw checkInOpenAt and gives null attendance without an application", async () => {
    db.educationSession.findMany.mockResolvedValue([row("s1", new Date())]);
    const out = await listSessionsWithMyAttendance("off-1", null);
    expect(out[0]).not.toHaveProperty("checkInOpenAt");
    expect(out[0]).toMatchObject({ checkInOpen: true, myAttendance: null });
    expect(db.educationAttendance.findMany).not.toHaveBeenCalled();
  });

  it("attaches the caller's marks by session", async () => {
    db.educationSession.findMany.mockResolvedValue([row("s1", null), row("s2", null)]);
    db.educationAttendance.findMany.mockResolvedValue([{ sessionId: "s2", status: "Excused" }]);
    const out = await listSessionsWithMyAttendance("off-1", "app-1");
    expect(db.educationAttendance.findMany.mock.calls[0][0].where).toEqual({ applicationId: "app-1" });
    expect(out.map((s) => [s.id, s.myAttendance, s.checkInOpen])).toEqual([
      ["s1", null, false],
      ["s2", "Excused", false],
    ]);
  });
});

describe("getHubData", () => {
  const args = { offeringId: "off-1", userId: "u1", applicationId: "app-1", isManager: false };

  beforeEach(() => {
    db.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Intro", descriptionDocId: "desc-room" });
    db.instructorAssignment.findMany.mockResolvedValue([
      { user: { id: "ins-1", firstName: "Grace", lastName: "Hopper", photoUrl: "p.png" } },
    ]);
    db.educationApplication.findMany.mockResolvedValue([
      { applicant: { id: "u1", firstName: "Ada", lastName: "Lovelace", photoUrl: null } },
      { applicant: { id: "u2", firstName: "Alan", lastName: "", photoUrl: null } },
    ]);
    db.educationSession.findMany.mockResolvedValue([]);
    db.educationAttendance.findMany.mockResolvedValue([]);
    db.educationSubmission.findMany.mockResolvedValue([]);
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" });
    db.educationCertificate.findUnique.mockResolvedValue({ id: "cert-1" });
    vi.mocked(listAssignments).mockResolvedValue([
      { id: "a1", title: "HW1", dueAt: null, points: 10, sessionSequence: 2 },
      { id: "a2", title: "HW2", dueAt: null, points: null, sessionSequence: null },
    ] as never);
  });

  it("returns null for an unknown offering", async () => {
    db.educationOffering.findUnique.mockResolvedValue(null);
    expect(await getHubData(args)).toBeNull();
  });

  it("renders people, flags me, and trims blank last names", async () => {
    const out = (await getHubData(args))!;
    expect(out.instructors).toEqual([{ id: "ins-1", name: "Grace Hopper", photoUrl: "resolved:p.png" }]);
    expect(out.classmates.map((c) => [c.name, c.isMe])).toEqual([["Ada Lovelace", true], ["Alan", false]]);
    expect(out.offering.descriptionHtml).toBe("<p>desc-room</p>");
    expect(out.myCertificateId).toBe("cert-1");
    expect(out.currentUserName).toBe("Ada Lovelace");
  });

  it("only shows grade and score for graded submissions", async () => {
    const submittedAt = new Date();
    db.educationSubmission.findMany.mockResolvedValue([
      { assignmentId: "a1", submittedAt, grade: "A", score: 9, gradedAt: new Date() },
      { assignmentId: "a2", submittedAt, grade: "B", score: 5, gradedAt: null },
    ]);
    const out = (await getHubData(args))!;
    expect(out.assignments[0]).toMatchObject({ mySubmittedAt: submittedAt, myGrade: "A", myScore: 9, sessionSequence: 2 });
    expect(out.assignments[1]).toMatchObject({ mySubmittedAt: submittedAt, myGrade: null, myScore: null });
    expect(db.educationSubmission.findMany.mock.calls[0][0].where).toEqual({ studentId: "u1" });
  });

  it("skips per-application lookups and falls back to a default name when unknown", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const out = (await getHubData({ ...args, applicationId: null, isManager: true }))!;
    expect(studentVisibleFeedback).not.toHaveBeenCalled();
    expect(db.educationCertificate.findUnique).not.toHaveBeenCalled();
    expect(out.myFeedback).toBeNull();
    expect(out.myCertificateId).toBeNull();
    expect(out.isManager).toBe(true);
    expect(out.currentUserName).toBe("Student");
  });

  it("skips the description doc when there is none", async () => {
    db.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Intro", descriptionDocId: null });
    expect((await getHubData(args))!.offering.descriptionHtml).toBe("");
  });
});
