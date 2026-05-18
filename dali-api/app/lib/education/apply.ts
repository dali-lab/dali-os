import { prisma } from "~/lib/db";
import { sendApplicationSubmittedEmail } from "./email";
import { syncSessionRoster } from "./roster-sync";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

// Application / RSVP creation. Mirrors the decisions module — the DB writes
// happen in one transaction, side effects (email + calendar sync) fire after.
//
// For requiresReview=true offerings, the application is left at "Submitted"
// for the instructor to review. For requiresReview=false, we attempt to
// auto-approve up to capacity and waitlist past that.

export interface ApplyInput {
  offeringId: string;
  applicantUserId: string;
  /** questionId → answer text. Validated against EducationApplicationQuestion. */
  answers: Record<string, string>;
}

export interface ApplyResult {
  applicationId: string;
  status: EduApplicationStatus;
  /** True when the apply resurrected a withdrawn row (vs created fresh). */
  reapplied: boolean;
}

export type ApplyError =
  | { kind: "OfferingNotFound" }
  | { kind: "OfferingNotPublished" }
  | { kind: "RegistrationClosed" }
  | { kind: "MissingRequiredAnswer"; questionId: string };

export type ApplyOutcome =
  | { ok: true; result: ApplyResult }
  | { ok: false; error: ApplyError };

export async function apply(input: ApplyInput): Promise<ApplyOutcome> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: input.offeringId },
    include: { applicationQuestions: true },
  });
  if (!offering) return { ok: false, error: { kind: "OfferingNotFound" } };
  if (offering.status !== "Published") {
    return { ok: false, error: { kind: "OfferingNotPublished" } };
  }
  const now = new Date();
  if (now < offering.registrationOpensAt || now > offering.registrationClosesAt) {
    return { ok: false, error: { kind: "RegistrationClosed" } };
  }

  for (const q of offering.applicationQuestions) {
    if (!q.required) continue;
    const ans = input.answers[q.id]?.trim();
    if (!ans) return { ok: false, error: { kind: "MissingRequiredAnswer", questionId: q.id } };
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: input.applicantUserId,
          offeringId: input.offeringId,
        },
      },
    });

    const reapplied =
      existing !== null &&
      (existing.status === "Withdrawn" || existing.status === "Rejected");

    let status: EduApplicationStatus = "Submitted";

    if (!offering.requiresReview) {
      const approved = await tx.educationApplication.count({
        where: { offeringId: input.offeringId, status: "Approved" },
      });
      status = approved < offering.capacity ? "Approved" : "Waitlisted";
    }

    let app;
    if (existing) {
      // Idempotent re-apply: reset answers + status. Disallow re-applying
      // when the user already has an active application.
      if (
        existing.status !== "Withdrawn" &&
        existing.status !== "Rejected"
      ) {
        return { existing: true, app: existing, status: existing.status, reapplied: false };
      }
      app = await tx.educationApplication.update({
        where: { id: existing.id },
        data: {
          status,
          submittedAt: new Date(),
          reviewedAt: offering.requiresReview ? null : new Date(),
          reviewedBy: null,
        },
      });
      await tx.educationApplicationAnswer.deleteMany({
        where: { applicationId: existing.id },
      });
    } else {
      app = await tx.educationApplication.create({
        data: {
          applicantUserId: input.applicantUserId,
          offeringId: input.offeringId,
          status,
        },
      });
    }

    const answerRows = Object.entries(input.answers)
      .filter(([_, content]) => content.trim().length > 0)
      .map(([questionId, content]) => ({
        applicationId: app.id,
        questionId,
        content,
      }));
    if (answerRows.length > 0) {
      await tx.educationApplicationAnswer.createMany({ data: answerRows });
    }

    return { existing: false, app, status, reapplied };
  });

  // Side effects: confirmation email + calendar sync if we auto-approved.
  const user = await prisma.user.findUnique({
    where: { id: input.applicantUserId },
    select: {
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  if (user) {
    const email = user.daliEmail ?? user.dartmouthEmail;
    if (email) {
      await sendApplicationSubmittedEmail({
        to: { email, firstName: user.firstName },
        offeringTitle: offering.title,
        requiresReview: offering.requiresReview,
      });
    }
  }

  if (result.status === "Approved") {
    syncSessionRoster(input.offeringId).catch((err) => {
      console.error("[education:apply] roster sync failed", err);
    });
  }

  return {
    ok: true,
    result: {
      applicationId: result.app.id,
      status: result.status,
      reapplied: result.reapplied,
    },
  };
}
