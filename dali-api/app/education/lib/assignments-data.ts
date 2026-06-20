import { prisma } from "~/lib/db";
import type { SubmissionType } from "~/generated/prisma/enums";

export interface CreateAssignmentInput {
  offeringId: string;
  title: string;
  submissionType: SubmissionType;
  dueAt?: Date | null;
  sessionId?: string | null;
  instructionsDocId?: string | null;
}

export async function createAssignment(input: CreateAssignmentInput) {
  return prisma.educationAssignment.create({
    data: {
      offeringId: input.offeringId,
      sessionId: input.sessionId ?? null,
      title: input.title,
      submissionType: input.submissionType,
      dueAt: input.dueAt ?? null,
      instructionsDocId: input.instructionsDocId ?? null,
    },
  });
}

export async function updateAssignment(
  id: string,
  patch: Partial<{
    title: string;
    submissionType: SubmissionType;
    dueAt: Date | null;
    sessionId: string | null;
    instructionsDocId: string | null;
  }>,
) {
  return prisma.educationAssignment.update({
    where: { id },
    data: {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.submissionType !== undefined && { submissionType: patch.submissionType }),
      ...(patch.dueAt !== undefined && { dueAt: patch.dueAt }),
      ...(patch.sessionId !== undefined && { sessionId: patch.sessionId }),
      ...(patch.instructionsDocId !== undefined && { instructionsDocId: patch.instructionsDocId }),
    },
  });
}

export async function deleteAssignment(id: string) {
  await prisma.educationSubmission.deleteMany({ where: { assignmentId: id } });
  await prisma.educationAssignment.delete({ where: { id } });
}

// Submission body shape: stored as JSON in `files` to avoid a schema change.
// `body` is the text portion (optional); `attachments` is the file portion
// (optional). The `submissionType` on the parent assignment dictates which
// fields are required at submit time.
export interface SubmissionBody {
  body?: string;
  attachments?: { key: string; name: string; contentType: string; size: number }[];
}

export interface SubmitAssignmentInput {
  assignmentId: string;
  studentId: string;
  payload: SubmissionBody;
}

export async function submitAssignment(input: SubmitAssignmentInput) {
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: input.assignmentId },
    select: { id: true, offeringId: true, submissionType: true, dueAt: true },
  });
  if (!assignment) throw new Error("Assignment not found");

  // Validate based on submissionType.
  const hasText = !!input.payload.body?.trim();
  const hasFiles = (input.payload.attachments?.length ?? 0) > 0;
  if (assignment.submissionType === "Text" && !hasText) {
    throw new Error("This assignment requires a text response");
  }
  if (assignment.submissionType === "File" && !hasFiles) {
    throw new Error("This assignment requires a file upload");
  }
  if (assignment.submissionType === "Mixed" && !hasText && !hasFiles) {
    throw new Error("Add a response or file before submitting");
  }

  // Link to the student's application if one exists (gives instructors easy
  // grouping). Not strictly required by the schema.
  const application = assignment.offeringId
    ? await prisma.educationApplication.findUnique({
        where: {
          applicantUserId_offeringId: {
            applicantUserId: input.studentId,
            offeringId: assignment.offeringId,
          },
        },
        select: { id: true, status: true },
      })
    : null;
  if (!application || application.status !== "Approved") {
    throw new Error("Only Approved enrollees can submit");
  }

  return prisma.educationSubmission.upsert({
    where: {
      assignmentId_studentId: {
        assignmentId: input.assignmentId,
        studentId: input.studentId,
      },
    },
    update: {
      files: input.payload as any,
      submittedAt: new Date(),
    },
    create: {
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      files: input.payload as any,
      submittedAt: new Date(),
      educationApplicationId: application.id,
    },
  });
}

export async function getAssignmentWithMySubmission(assignmentId: string, studentId: string) {
  const [assignment, submission] = await Promise.all([
    prisma.educationAssignment.findUnique({
      where: { id: assignmentId },
      include: { offering: { select: { id: true, title: true } } },
    }),
    prisma.educationSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
    }),
  ]);
  return { assignment, submission };
}

export async function listSubmissionsForAssignment(assignmentId: string) {
  return prisma.educationSubmission.findMany({
    where: { assignmentId },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, dartmouthEmail: true, netId: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
}

export interface FeedbackPayload {
  body: string;
  by: string;
  at: string;
}

/**
 * Set graded status + feedback text on a submission. Feedback is stored
 * inside the existing `files` JSON column under a `feedback` key so we can
 * avoid a schema change. `gradedAt` flips to now() (or null to un-grade).
 */
export async function gradeSubmission(input: {
  submissionId: string;
  feedback: string;
  graded: boolean;
  byUserId: string;
}) {
  const existing = await prisma.educationSubmission.findUnique({
    where: { id: input.submissionId },
  });
  if (!existing) throw new Error("Submission not found");

  const currentFiles = (existing.files ?? {}) as Record<string, unknown>;
  const trimmed = input.feedback.trim();
  const nextFiles = {
    ...currentFiles,
    feedback: trimmed
      ? { body: trimmed, by: input.byUserId, at: new Date().toISOString() }
      : undefined,
  };
  // Strip undefined explicitly so Prisma stores a plain JSON.
  if (nextFiles.feedback === undefined) delete (nextFiles as any).feedback;

  return prisma.educationSubmission.update({
    where: { id: input.submissionId },
    data: {
      files: nextFiles as any,
      gradedAt: input.graded ? new Date() : null,
    },
  });
}
