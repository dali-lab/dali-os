import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";

// One consolidated instructor note per enrolled student per offering, two
// lanes as two named columns:
//   feedback     — student-visible ("alongside their certificate")
//   internalNote — HIRING-ONLY; the only sanctioned readers are the manage
//                  roster/notes UI (offering managers) and the hiring
//                  application views (reviewer access + confidentiality).
// Student/portal surfaces must go through studentVisibleFeedback, which
// structurally cannot return the internal lane.

export async function upsertStudentNote(args: {
  applicationId: string;
  actorId: string;
  feedback?: string | null;
  internalNote?: string | null;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const application = await prisma.educationApplication.findUnique({
    where: { id: args.applicationId },
    select: { id: true, offeringId: true },
  });
  if (!application) return { error: "Application not found", status: 404 };

  const now = new Date();
  const feedbackPatch =
    args.feedback !== undefined
      ? {
          feedback: args.feedback?.trim() || null,
          feedbackUpdatedAt: now,
          feedbackAuthorId: args.actorId,
        }
      : {};
  const internalPatch =
    args.internalNote !== undefined
      ? {
          internalNote: args.internalNote?.trim() || null,
          internalNoteUpdatedAt: now,
          internalNoteAuthorId: args.actorId,
        }
      : {};

  await prisma.educationStudentNote.upsert({
    where: { applicationId: args.applicationId },
    create: {
      applicationId: args.applicationId,
      ...feedbackPatch,
      ...internalPatch,
    },
    update: { ...feedbackPatch, ...internalPatch },
  });

  await logAuditEvent({
    action: "education.note.update",
    userId: args.actorId,
    targetId: args.applicationId,
    metadata: {
      offeringId: application.offeringId,
      lanes: [
        ...(args.feedback !== undefined ? ["feedback"] : []),
        ...(args.internalNote !== undefined ? ["internal"] : []),
      ],
    },
  });
  return { ok: true };
}

/** Both lanes for the manage UI. Caller must hold the offering-manager gate. */
export async function notesForOffering(offeringId: string) {
  const notes = await prisma.educationStudentNote.findMany({
    where: { application: { offeringId } },
    select: {
      applicationId: true,
      feedback: true,
      internalNote: true,
      feedbackUpdatedAt: true,
      internalNoteUpdatedAt: true,
    },
  });
  return new Map(notes.map((n) => [n.applicationId, n]));
}

/**
 * The ONLY note reader student/portal surfaces may call. Selects the
 * student-visible lane exclusively — no code path from here can leak
 * internalNote.
 */
export async function studentVisibleFeedback(applicationId: string): Promise<{
  feedback: string;
  updatedAt: Date | null;
  authorName: string | null;
} | null> {
  const note = await prisma.educationStudentNote.findUnique({
    where: { applicationId },
    select: {
      feedback: true,
      feedbackUpdatedAt: true,
      feedbackAuthor: { select: { firstName: true, lastName: true } },
    },
  });
  if (!note?.feedback) return null;
  return {
    feedback: note.feedback,
    updatedAt: note.feedbackUpdatedAt,
    authorName: note.feedbackAuthor
      ? `${note.feedbackAuthor.firstName} ${note.feedbackAuthor.lastName}`.trim()
      : null,
  };
}
