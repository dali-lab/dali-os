import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { notifyNewAssignment, notifyGraded } from "./notifications.server";
import type { SubmissionType } from "~/generated/prisma/client";

/**
 * Deterministic collab room id for a student's Doc-type submission body.
 * Format mirrors the instructions room (`eduassignment:{id}:instructions`) and
 * the feedback room (`edusubmission:{id}:feedback`).
 */
export function submissionDocRoom(assignmentId: string, studentId: string): string {
  return `edusubmission:${assignmentId}:${studentId}:body`;
}

// Assignments are scoped to the offering as a whole or to one session
// (exactly one of offeringId/sessionId — app-level enforced here). Rich
// instructions live in a bare collab room `eduassignment:{id}:instructions`
// (epic pattern) written to instructionsDocId on first request.

export async function offeringIdForAssignment(assignmentId: string): Promise<string | null> {
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: assignmentId },
    select: { offeringId: true, session: { select: { offeringId: true } } },
  });
  return assignment?.offeringId ?? assignment?.session?.offeringId ?? null;
}

export async function listAssignments(offeringId: string) {
  const sessions = await prisma.educationSession.findMany({
    where: { offeringId },
    select: { id: true, sequence: true },
  });
  const assignments = await prisma.educationAssignment.findMany({
    where: {
      OR: [{ offeringId }, { sessionId: { in: sessions.map((s) => s.id) } }],
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      title: true,
      dueAt: true,
      submissionType: true,
      instructionsDocId: true,
      sessionId: true,
      points: true,
      _count: { select: { submissions: true } },
    },
  });
  const sequenceBySession = new Map(sessions.map((s) => [s.id, s.sequence]));
  return assignments.map((a) => ({
    ...a,
    sessionSequence: a.sessionId ? (sequenceBySession.get(a.sessionId) ?? null) : null,
  }));
}

type MutationResult = { ok: true; id?: string } | { error: string; status: number };

export async function createAssignment(args: {
  offeringId: string;
  sessionId?: string | null;
  title: string;
  dueAt: Date | null;
  submissionType: SubmissionType;
  /** Optional point value (≥1). Null = complete/incomplete grading. */
  points?: number | null;
  actorId: string;
}): Promise<MutationResult> {
  const title = args.title.trim();
  if (!title) return { error: "Title is required", status: 400 };
  if (args.sessionId) {
    const session = await prisma.educationSession.findUnique({
      where: { id: args.sessionId },
      select: { offeringId: true },
    });
    if (!session || session.offeringId !== args.offeringId)
      return { error: "Session not found", status: 404 };
  }
  const assignment = await prisma.educationAssignment.create({
    data: {
      // XOR: session-scoped assignments leave offeringId null.
      offeringId: args.sessionId ? null : args.offeringId,
      sessionId: args.sessionId ?? null,
      title,
      dueAt: args.dueAt,
      submissionType: args.submissionType,
      points: args.points ?? null,
    },
    select: { id: true },
  });
  // Reserve the instructions room up front so the builder can link straight
  // into an editor; the CollabDocument row is created lazily on first edit.
  await prisma.educationAssignment.update({
    where: { id: assignment.id },
    data: { instructionsDocId: `eduassignment:${assignment.id}:instructions` },
  });
  // New work shouldn't sit buried in a tab — tell every enrolled student.
  await notifyNewAssignment({
    offeringId: args.offeringId,
    assignmentId: assignment.id,
    assignmentTitle: title,
    dueAt: args.dueAt,
  }).catch((err) => {
    console.error("assignment notification fan-out failed", {
      assignmentId: assignment.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await logAuditEvent({
    action: "education.assignment.create",
    userId: args.actorId,
    targetId: assignment.id,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true, id: assignment.id };
}

export async function updateAssignment(args: {
  assignmentId: string;
  offeringId: string;
  title: string;
  dueAt: Date | null;
  submissionType: SubmissionType;
  /** Optional point value (≥1). Null = complete/incomplete grading. */
  points?: number | null;
  actorId: string;
}): Promise<MutationResult> {
  const owner = await offeringIdForAssignment(args.assignmentId);
  if (owner !== args.offeringId) return { error: "Assignment not found", status: 404 };
  const title = args.title.trim();
  if (!title) return { error: "Title is required", status: 400 };
  await prisma.educationAssignment.update({
    where: { id: args.assignmentId },
    data: { title, dueAt: args.dueAt, submissionType: args.submissionType, points: args.points ?? null },
  });
  await logAuditEvent({
    action: "education.assignment.update",
    userId: args.actorId,
    targetId: args.assignmentId,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true, id: args.assignmentId };
}

export async function deleteAssignment(args: {
  assignmentId: string;
  offeringId: string;
  actorId: string;
}): Promise<MutationResult> {
  const owner = await offeringIdForAssignment(args.assignmentId);
  if (owner !== args.offeringId) return { error: "Assignment not found", status: 404 };
  const submissions = await prisma.educationSubmission.count({
    where: { assignmentId: args.assignmentId },
  });
  if (submissions > 0)
    return { error: "Students have submitted — this assignment can't be deleted", status: 400 };
  await prisma.educationAssignment.delete({ where: { id: args.assignmentId } });
  await logAuditEvent({
    action: "education.assignment.delete",
    userId: args.actorId,
    targetId: args.assignmentId,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true };
}

export async function getAssignmentForStudent(args: {
  assignmentId: string;
  offeringId: string;
  studentId: string;
}) {
  const owner = await offeringIdForAssignment(args.assignmentId);
  if (owner !== args.offeringId) return null;
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: args.assignmentId },
    select: {
      id: true,
      title: true,
      dueAt: true,
      submissionType: true,
      instructionsDocId: true,
      points: true,
    },
  });
  if (!assignment) return null;
  const submission = await prisma.educationSubmission.findUnique({
    where: {
      assignmentId_studentId: {
        assignmentId: args.assignmentId,
        studentId: args.studentId,
      },
    },
    select: {
      id: true,
      textContent: true,
      files: true,
      link: true,
      contentDocId: true,
      submittedAt: true,
      gradedAt: true,
      grade: true,
      score: true,
      feedbackText: true,
    },
  });
  return { assignment, submission };
}

/**
 * Student submit / resubmit. Enrollment is gated by the route; here we
 * enforce the submission-type shape and the due date (with a manager-side
 * regrade path via gradeSubmission). Files are S3 keys from the existing
 * presign flow, stored as JSON.
 *
 * New modes:
 *  - Link: stores a validated http(s) URL in submission.link.
 *  - Complete: no artifact; upserts with submittedAt set.
 *  - Doc: the body lives in the collab room (contentDocId); we ensure the row
 *    exists with contentDocId set and record submittedAt.
 */
export async function submitAssignment(args: {
  assignmentId: string;
  offeringId: string;
  studentId: string;
  applicationId: string;
  textContent: string;
  files: { key: string; name: string }[];
  link?: string;
}): Promise<MutationResult> {
  const owner = await offeringIdForAssignment(args.assignmentId);
  if (owner !== args.offeringId) return { error: "Assignment not found", status: 404 };
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: args.assignmentId },
    select: { dueAt: true, submissionType: true },
  });
  if (!assignment) return { error: "Assignment not found", status: 404 };
  if (assignment.dueAt && assignment.dueAt < new Date())
    return { error: "This assignment is past due", status: 400 };

  const text = args.textContent.trim();
  const link = args.link?.trim() ?? "";

  // Per-type validation and upsert payload.
  let upsertData: {
    textContent?: string | null;
    files?: { key: string; name: string }[];
    link?: string | null;
    contentDocId?: string | null;
    submittedAt: Date;
  };

  switch (assignment.submissionType) {
    case "Text":
      if (!text) return { error: "A text answer is required", status: 400 };
      upsertData = { textContent: text, files: [], link: null, submittedAt: new Date() };
      break;

    case "File":
      if (args.files.length === 0) return { error: "A file is required", status: 400 };
      upsertData = { textContent: null, files: args.files, link: null, submittedAt: new Date() };
      break;

    case "Mixed":
      if (!text && args.files.length === 0)
        return { error: "Add a text answer or a file", status: 400 };
      upsertData = { textContent: text || null, files: args.files, link: null, submittedAt: new Date() };
      break;

    case "Link": {
      if (!link) return { error: "A deliverable link is required", status: 400 };
      if (!/^https?:\/\/.+/.test(link))
        return { error: "The link must be a valid http(s) URL", status: 400 };
      upsertData = { textContent: null, files: [], link, submittedAt: new Date() };
      break;
    }

    case "Complete":
      // No artifact required; just record the completion timestamp.
      upsertData = { submittedAt: new Date() };
      break;

    case "Doc": {
      // The doc body lives in the collab room; submitting just sets submittedAt.
      const contentDocId = submissionDocRoom(args.assignmentId, args.studentId);
      upsertData = { contentDocId, submittedAt: new Date() };
      break;
    }

    default:
      return { error: "Unknown submission type", status: 400 };
  }

  await prisma.educationSubmission.upsert({
    where: {
      assignmentId_studentId: {
        assignmentId: args.assignmentId,
        studentId: args.studentId,
      },
    },
    create: {
      assignmentId: args.assignmentId,
      studentId: args.studentId,
      educationApplicationId: args.applicationId,
      textContent: upsertData.textContent ?? null,
      files: upsertData.files ?? [],
      link: upsertData.link ?? null,
      contentDocId: upsertData.contentDocId ?? null,
      submittedAt: upsertData.submittedAt,
    },
    update: {
      ...("textContent" in upsertData ? { textContent: upsertData.textContent ?? null } : {}),
      ...("files" in upsertData ? { files: upsertData.files } : {}),
      ...("link" in upsertData ? { link: upsertData.link ?? null } : {}),
      ...("contentDocId" in upsertData ? { contentDocId: upsertData.contentDocId ?? null } : {}),
      submittedAt: upsertData.submittedAt,
    },
  });
  await logAuditEvent({
    action: "education.submission.submit",
    userId: args.studentId,
    targetId: args.assignmentId,
    metadata: { offeringId: args.offeringId },
  });
  return { ok: true };
}

/**
 * Ensure a Doc-type submission row exists with contentDocId set so the collab
 * editor has a room to bind to on first open (before the student turns in).
 * No-op if the row already has a contentDocId.
 */
export async function ensureDocSubmissionRow(args: {
  assignmentId: string;
  studentId: string;
  applicationId: string;
}): Promise<void> {
  const contentDocId = submissionDocRoom(args.assignmentId, args.studentId);
  await prisma.educationSubmission.upsert({
    where: {
      assignmentId_studentId: {
        assignmentId: args.assignmentId,
        studentId: args.studentId,
      },
    },
    create: {
      assignmentId: args.assignmentId,
      studentId: args.studentId,
      educationApplicationId: args.applicationId,
      contentDocId,
      files: [],
      submittedAt: null,
    },
    update: {
      // Only set contentDocId if missing — don't stomp submittedAt.
      contentDocId,
    },
  });
}

export async function listSubmissions(assignmentId: string) {
  return prisma.educationSubmission.findMany({
    where: { assignmentId },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      textContent: true,
      files: true,
      link: true,
      contentDocId: true,
      submittedAt: true,
      gradedAt: true,
      grade: true,
      score: true,
      feedbackText: true,
      student: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function gradeSubmission(args: {
  submissionId: string;
  offeringId: string;
  grade: string;
  /** Numeric score (0..points). Only persisted when the assignment has a points value. */
  score?: number | null;
  actorId: string;
}): Promise<MutationResult> {
  const submission = await prisma.educationSubmission.findUnique({
    where: { id: args.submissionId },
    select: {
      assignmentId: true,
      studentId: true,
      assignment: { select: { title: true, points: true } },
    },
  });
  if (!submission) return { error: "Submission not found", status: 404 };
  const owner = await offeringIdForAssignment(submission.assignmentId);
  if (owner !== args.offeringId) return { error: "Submission not found", status: 404 };
  // feedbackText is owned by the collab feedback doc (edusubmission:{id}:feedback)
  // and mirrored on save; grading only sets the grade + release timestamp.
  // score is only stored when the assignment carries a points value.
  const scoreValue =
    submission.assignment.points != null && args.score != null ? args.score : null;
  await prisma.educationSubmission.update({
    where: { id: args.submissionId },
    data: {
      grade: args.grade.trim() || null,
      gradedAt: new Date(),
      score: scoreValue,
    },
  });
  await logAuditEvent({
    action: "education.submission.grade",
    userId: args.actorId,
    targetId: args.submissionId,
    metadata: { offeringId: args.offeringId },
  });
  await notifyGraded({
    studentId: submission.studentId,
    offeringId: args.offeringId,
    assignmentId: submission.assignmentId,
    assignmentTitle: submission.assignment.title,
  }).catch((err) => {
    console.error("grade notification fan-out failed", {
      submissionId: args.submissionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return { ok: true };
}
