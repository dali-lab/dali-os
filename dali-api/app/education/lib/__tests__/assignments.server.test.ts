import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../notifications.server", () => ({
  notifyNewAssignment: vi.fn(),
  notifyGraded: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { notifyNewAssignment, notifyGraded } from "../notifications.server";
import {
  submissionDocRoom,
  offeringIdForAssignment,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignmentForStudent,
  submitAssignment,
  ensureDocSubmissionRow,
  gradeSubmission,
} from "../assignments.server";

type M = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as M;
db.educationSubmission.count = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notifyNewAssignment).mockResolvedValue(undefined as never);
  vi.mocked(notifyGraded).mockResolvedValue(undefined as never);
});

const owns = (offeringId = "off-1") =>
  db.educationAssignment.findUnique.mockResolvedValueOnce({ offeringId, session: null });

describe("offeringIdForAssignment", () => {
  it("resolves direct, session-scoped, and missing assignments", async () => {
    db.educationAssignment.findUnique
      .mockResolvedValueOnce({ offeringId: "o1", session: null })
      .mockResolvedValueOnce({ offeringId: null, session: { offeringId: "o2" } })
      .mockResolvedValueOnce(null);
    expect(await offeringIdForAssignment("a")).toBe("o1");
    expect(await offeringIdForAssignment("b")).toBe("o2");
    expect(await offeringIdForAssignment("c")).toBeNull();
  });
});

describe("submissionDocRoom", () => {
  it("is deterministic per assignment and student", () => {
    expect(submissionDocRoom("a1", "s1")).toBe("edusubmission:a1:s1:body");
  });
});

describe("listAssignments", () => {
  it("includes offering-wide and session-scoped assignments, due-date ordered, with the session sequence", async () => {
    db.educationSession.findMany.mockResolvedValue([{ id: "s1", sequence: 3 }]);
    db.educationAssignment.findMany.mockResolvedValue([
      { id: "a1", sessionId: "s1" },
      { id: "a2", sessionId: null },
      { id: "a3", sessionId: "gone" },
    ]);
    const out = await listAssignments("off-1");
    const arg = db.educationAssignment.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ OR: [{ offeringId: "off-1" }, { sessionId: { in: ["s1"] } }] });
    expect(arg.orderBy).toEqual({ dueAt: "asc" });
    expect(out.map((a) => a.sessionSequence)).toEqual([3, null, null]);
  });
});

describe("createAssignment", () => {
  const base = {
    offeringId: "off-1",
    title: "  Essay ",
    dueAt: null,
    submissionType: "Text" as const,
    actorId: "ins-1",
  };

  it("rejects a blank title", async () => {
    expect(await createAssignment({ ...base, title: "  " })).toEqual({ error: "Title is required", status: 400 });
    expect(db.educationAssignment.create).not.toHaveBeenCalled();
  });

  it("rejects a session from a different offering or a missing session", async () => {
    db.educationSession.findUnique.mockResolvedValueOnce({ offeringId: "off-2" });
    expect(await createAssignment({ ...base, sessionId: "s" })).toEqual({ error: "Session not found", status: 404 });
    db.educationSession.findUnique.mockResolvedValueOnce(null);
    expect(await createAssignment({ ...base, sessionId: "s" })).toMatchObject({ status: 404 });
    expect(db.educationAssignment.create).not.toHaveBeenCalled();
  });

  it("creates an offering-wide assignment, reserves the instructions room, notifies and audits", async () => {
    const due = new Date("2030-01-01");
    db.educationAssignment.create.mockResolvedValue({ id: "a1" });
    expect(await createAssignment({ ...base, dueAt: due, points: 5 })).toEqual({ ok: true, id: "a1" });
    expect(db.educationAssignment.create.mock.calls[0][0].data).toEqual({
      offeringId: "off-1",
      sessionId: null,
      title: "Essay",
      dueAt: due,
      submissionType: "Text",
      points: 5,
    });
    expect(db.educationAssignment.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { instructionsDocId: "eduassignment:a1:instructions" },
    });
    expect(notifyNewAssignment).toHaveBeenCalledWith({
      offeringId: "off-1",
      assignmentId: "a1",
      assignmentTitle: "Essay",
      dueAt: due,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "education.assignment.create", userId: "ins-1", targetId: "a1" }),
    );
  });

  it("leaves offeringId null for a session-scoped assignment", async () => {
    db.educationSession.findUnique.mockResolvedValue({ offeringId: "off-1" });
    db.educationAssignment.create.mockResolvedValue({ id: "a1" });
    await createAssignment({ ...base, sessionId: "s1" });
    expect(db.educationAssignment.create.mock.calls[0][0].data).toMatchObject({
      offeringId: null,
      sessionId: "s1",
      points: null,
    });
  });

  it("still succeeds when the notification fan-out fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.educationAssignment.create.mockResolvedValue({ id: "a1" });
    vi.mocked(notifyNewAssignment).mockRejectedValue(new Error("boom"));
    expect(await createAssignment(base)).toEqual({ ok: true, id: "a1" });
    expect(logAuditEvent).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("updateAssignment", () => {
  const args = {
    assignmentId: "a1",
    offeringId: "off-1",
    title: " New ",
    dueAt: null,
    submissionType: "Link" as const,
    actorId: "ins-1",
  };

  it("404s when the assignment belongs to another offering", async () => {
    owns("off-2");
    expect(await updateAssignment(args)).toEqual({ error: "Assignment not found", status: 404 });
    expect(db.educationAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    owns();
    expect(await updateAssignment({ ...args, title: " " })).toMatchObject({ status: 400 });
  });

  it("writes trimmed fields and clears points when omitted", async () => {
    owns();
    expect(await updateAssignment(args)).toEqual({ ok: true, id: "a1" });
    expect(db.educationAssignment.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { title: "New", dueAt: null, submissionType: "Link", points: null },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "education.assignment.update" }));
  });
});

describe("deleteAssignment", () => {
  const args = { assignmentId: "a1", offeringId: "off-1", actorId: "ins-1" };

  it("404s for another offering's assignment", async () => {
    owns("off-2");
    expect(await deleteAssignment(args)).toMatchObject({ status: 404 });
    expect(db.educationAssignment.delete).not.toHaveBeenCalled();
  });

  it("refuses once any student has submitted", async () => {
    owns();
    db.educationSubmission.count.mockResolvedValue(1);
    expect(await deleteAssignment(args)).toMatchObject({ status: 400 });
    expect(db.educationSubmission.count).toHaveBeenCalledWith({ where: { assignmentId: "a1" } });
    expect(db.educationAssignment.delete).not.toHaveBeenCalled();
  });

  it("deletes an assignment with no submissions and audits it", async () => {
    owns();
    db.educationSubmission.count.mockResolvedValue(0);
    expect(await deleteAssignment(args)).toEqual({ ok: true });
    expect(db.educationAssignment.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "education.assignment.delete" }));
  });
});

describe("getAssignmentForStudent", () => {
  const args = { assignmentId: "a1", offeringId: "off-1", studentId: "st-1" };

  it("returns null for another offering's assignment without loading it", async () => {
    owns("off-2");
    expect(await getAssignmentForStudent(args)).toBeNull();
    expect(db.educationSubmission.findUnique).not.toHaveBeenCalled();
  });

  it("returns the assignment with only this student's submission", async () => {
    owns();
    db.educationAssignment.findUnique.mockResolvedValueOnce({ id: "a1", title: "HW" });
    db.educationSubmission.findUnique.mockResolvedValue({ id: "sub" });
    expect(await getAssignmentForStudent(args)).toEqual({ assignment: { id: "a1", title: "HW" }, submission: { id: "sub" } });
    expect(db.educationSubmission.findUnique.mock.calls[0][0].where).toEqual({
      assignmentId_studentId: { assignmentId: "a1", studentId: "st-1" },
    });
  });

  it("returns a null submission before the student has started", async () => {
    owns();
    db.educationAssignment.findUnique.mockResolvedValueOnce({ id: "a1" });
    db.educationSubmission.findUnique.mockResolvedValue(null);
    expect((await getAssignmentForStudent(args))!.submission).toBeNull();
  });
});

describe("submitAssignment", () => {
  const base = {
    assignmentId: "a1",
    offeringId: "off-1",
    studentId: "st-1",
    applicationId: "app-1",
    textContent: "",
    files: [] as { key: string; name: string }[],
  };
  const setup = (a: { dueAt?: Date | null; submissionType: string } | null) => {
    owns();
    db.educationAssignment.findUnique.mockResolvedValueOnce(a);
  };

  it("404s for another offering's assignment", async () => {
    owns("off-2");
    expect(await submitAssignment(base)).toEqual({ error: "Assignment not found", status: 404 });
  });

  it("404s when the assignment row has vanished", async () => {
    setup(null);
    expect(await submitAssignment(base)).toMatchObject({ status: 404 });
  });

  it("rejects submissions after the due date and writes nothing", async () => {
    setup({ dueAt: new Date(Date.now() - 1000), submissionType: "Text" });
    expect(await submitAssignment({ ...base, textContent: "hi" })).toEqual({
      error: "This assignment is past due",
      status: 400,
    });
    expect(db.educationSubmission.upsert).not.toHaveBeenCalled();
  });

  it("accepts a submission before the due date and with no due date", async () => {
    setup({ dueAt: new Date(Date.now() + 100000), submissionType: "Text" });
    expect(await submitAssignment({ ...base, textContent: "hi" })).toEqual({ ok: true });
    setup({ dueAt: null, submissionType: "Text" });
    expect(await submitAssignment({ ...base, textContent: "hi" })).toEqual({ ok: true });
  });

  it.each([
    ["Text", {}, "A text answer is required"],
    ["Text", { textContent: "   " }, "A text answer is required"],
    ["File", {}, "A file is required"],
    ["Mixed", {}, "Add a text answer or a file"],
    ["Link", {}, "A deliverable link is required"],
    ["Link", { link: "ftp://x.edu" }, "The link must be a valid http(s) URL"],
    ["Link", { link: "javascript:alert(1)" }, "The link must be a valid http(s) URL"],
    ["Link", { link: "https://" }, "The link must be a valid http(s) URL"],
    ["Bogus", {}, "Unknown submission type"],
  ])("%s submission %j is rejected: %s", async (type, extra, error) => {
    setup({ dueAt: null, submissionType: type });
    expect(await submitAssignment({ ...base, ...extra })).toEqual({ error, status: 400 });
    expect(db.educationSubmission.upsert).not.toHaveBeenCalled();
  });

  const lastUpsert = () => db.educationSubmission.upsert.mock.calls.at(-1)![0];

  it("Text: stores trimmed text and clears files and link on both create and update", async () => {
    setup({ submissionType: "Text" });
    await submitAssignment({ ...base, textContent: "  answer  " });
    const call = lastUpsert();
    expect(call.where).toEqual({ assignmentId_studentId: { assignmentId: "a1", studentId: "st-1" } });
    expect(call.create).toMatchObject({
      assignmentId: "a1",
      studentId: "st-1",
      educationApplicationId: "app-1",
      textContent: "answer",
      files: [],
      link: null,
      contentDocId: null,
    });
    expect(call.create.submittedAt).toBeInstanceOf(Date);
    expect(call.update).toMatchObject({ textContent: "answer", files: [], link: null });
    expect(call.update.submittedAt).toBeInstanceOf(Date);
    expect(call.update).not.toHaveProperty("contentDocId");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "education.submission.submit", userId: "st-1", targetId: "a1" }),
    );
  });

  it("File: stores the files with no text", async () => {
    const files = [{ key: "k1", name: "a.pdf" }];
    setup({ submissionType: "File" });
    await submitAssignment({ ...base, files });
    expect(lastUpsert().create).toMatchObject({ textContent: null, files, link: null });
  });

  it("Mixed: accepts text alone, or files alone with null text", async () => {
    setup({ submissionType: "Mixed" });
    await submitAssignment({ ...base, textContent: "note" });
    expect(lastUpsert().update).toMatchObject({ textContent: "note", files: [] });
    const files = [{ key: "k", name: "n" }];
    setup({ submissionType: "Mixed" });
    await submitAssignment({ ...base, files });
    expect(lastUpsert().update).toMatchObject({ textContent: null, files });
  });

  it("Link: stores the trimmed link", async () => {
    setup({ submissionType: "Link" });
    await submitAssignment({ ...base, link: "  https://example.edu/x  " });
    expect(lastUpsert().create).toMatchObject({ link: "https://example.edu/x", textContent: null, files: [] });
  });

  it("Complete: resubmitting only refreshes submittedAt and leaves prior content alone", async () => {
    setup({ submissionType: "Complete" });
    await submitAssignment(base);
    const { update, create } = lastUpsert();
    expect(Object.keys(update)).toEqual(["submittedAt"]);
    expect(create).toMatchObject({ textContent: null, files: [], link: null, contentDocId: null });
  });

  it("Doc: binds the deterministic collab room and keeps other fields untouched on update", async () => {
    setup({ submissionType: "Doc" });
    await submitAssignment(base);
    const { update, create } = lastUpsert();
    expect(create.contentDocId).toBe("edusubmission:a1:st-1:body");
    expect(update.contentDocId).toBe("edusubmission:a1:st-1:body");
    expect(update).not.toHaveProperty("textContent");
    expect(update).not.toHaveProperty("files");
  });
});

describe("ensureDocSubmissionRow", () => {
  it("creates an unsubmitted row bound to the room, and on update only sets the room (never submittedAt)", async () => {
    await ensureDocSubmissionRow({ assignmentId: "a1", studentId: "st-1", applicationId: "app-1" });
    const call = db.educationSubmission.upsert.mock.calls[0][0];
    expect(call.create).toEqual({
      assignmentId: "a1",
      studentId: "st-1",
      educationApplicationId: "app-1",
      contentDocId: "edusubmission:a1:st-1:body",
      files: [],
      submittedAt: null,
    });
    expect(call.update).toEqual({ contentDocId: "edusubmission:a1:st-1:body" });
  });
});

describe("gradeSubmission", () => {
  const args = { submissionId: "sub-1", offeringId: "off-1", grade: " A- ", score: 9, actorId: "ins-1" };
  const found = (points: number | null) =>
    db.educationSubmission.findUnique.mockResolvedValue({
      assignmentId: "a1",
      studentId: "st-1",
      assignment: { title: "HW", points },
    });

  it("404s for a missing submission", async () => {
    db.educationSubmission.findUnique.mockResolvedValue(null);
    expect(await gradeSubmission(args)).toEqual({ error: "Submission not found", status: 404 });
  });

  it("404s when the submission's assignment belongs to another offering", async () => {
    found(10);
    owns("off-2");
    expect(await gradeSubmission(args)).toEqual({ error: "Submission not found", status: 404 });
    expect(db.educationSubmission.update).not.toHaveBeenCalled();
    expect(notifyGraded).not.toHaveBeenCalled();
  });

  it("stores the trimmed grade, a release timestamp and the score when the assignment has points", async () => {
    found(10);
    owns();
    expect(await gradeSubmission(args)).toEqual({ ok: true });
    const { where, data } = db.educationSubmission.update.mock.calls[0][0];
    expect(where).toEqual({ id: "sub-1" });
    expect(data.grade).toBe("A-");
    expect(data.score).toBe(9);
    expect(data.gradedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("feedbackText");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "education.submission.grade", userId: "ins-1", targetId: "sub-1" }),
    );
    expect(notifyGraded).toHaveBeenCalledWith({
      studentId: "st-1",
      offeringId: "off-1",
      assignmentId: "a1",
      assignmentTitle: "HW",
    });
  });

  it("drops the score for a complete/incomplete assignment (no points)", async () => {
    found(null);
    owns();
    await gradeSubmission(args);
    expect(db.educationSubmission.update.mock.calls[0][0].data.score).toBeNull();
  });

  it("keeps a score of 0 and stores a blank grade as null", async () => {
    found(10);
    owns();
    await gradeSubmission({ ...args, grade: "   ", score: 0 });
    const { data } = db.educationSubmission.update.mock.calls[0][0];
    expect(data.score).toBe(0);
    expect(data.grade).toBeNull();
  });

  it("sets a null score when none is given", async () => {
    found(10);
    owns();
    await gradeSubmission({ ...args, score: undefined });
    expect(db.educationSubmission.update.mock.calls[0][0].data.score).toBeNull();
  });

  it("still succeeds when the graded notification fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    found(10);
    owns();
    vi.mocked(notifyGraded).mockRejectedValue(new Error("x"));
    expect(await gradeSubmission(args)).toEqual({ ok: true });
    spy.mockRestore();
  });
});
