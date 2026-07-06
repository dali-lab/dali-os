import { prisma } from "~/lib/db";
import type { Prisma, EduApplicationStatus } from "~/generated/prisma/client";
import { validateAnswers } from "~/forms/lib/public-form";
import { loadOfferingApplicationForm } from "./application-form.server";
import { registrationOpen } from "./offerings.server";
import { notifyApplicationStatus } from "./notifications.server";
import { logAuditEvent } from "~/lib/audit";

export type SubmitApplicationResult =
  | { ok: true; status: EduApplicationStatus }
  | { error: string; status: number };

/** Row-lock the offering so concurrent submits can't both take the last seat. */
export async function lockOffering(
  tx: Prisma.TransactionClient,
  offeringId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "EducationOffering" WHERE id = ${offeringId} FOR UPDATE`;
}

export async function approvedCount(
  tx: Prisma.TransactionClient,
  offeringId: string,
): Promise<number> {
  return tx.educationApplication.count({
    where: { offeringId, status: "Approved" },
  });
}

export async function nextWaitlistRank(
  tx: Prisma.TransactionClient,
  offeringId: string,
): Promise<number> {
  const last = await tx.educationApplication.findFirst({
    where: { offeringId, status: "Waitlisted" },
    orderBy: { waitlistRank: "desc" },
    select: { waitlistRank: true },
  });
  return (last?.waitlistRank ?? 0) + 1;
}

/**
 * Submit (or resubmit) an application to an offering. One shared flow:
 * review-required offerings land as Submitted; RSVP-style offerings are
 * auto-approved under capacity and waitlisted past it, decided inside a
 * transaction that row-locks the offering. Resubmission is allowed while a
 * review-required application is still Submitted and the window is open;
 * a Withdrawn applicant may re-apply and goes through the decision branch
 * fresh. Approved/Waitlisted/Rejected applications are final here — status
 * changes go through the decision flow.
 */
export async function submitApplication(args: {
  offeringId: string;
  userId: string;
  answers: Record<string, unknown>;
}): Promise<SubmitApplicationResult> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: args.offeringId },
    select: {
      id: true,
      status: true,
      requiresReview: true,
      capacity: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
    },
  });
  if (!offering) return { error: "Offering not found.", status: 404 };
  if (!registrationOpen(offering))
    return { error: "Registration isn't open for this offering.", status: 400 };

  const form = await loadOfferingApplicationForm(args.offeringId, args.userId);
  if (!form)
    return { error: "This offering isn't accepting applications yet.", status: 400 };

  const invalid = await validateAnswers(form.questions, args.answers, args.userId);
  if (invalid) return invalid;

  const existing = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: {
        applicantUserId: args.userId,
        offeringId: args.offeringId,
      },
    },
    select: { id: true, status: true, formSubmissionId: true },
  });
  if (
    existing &&
    (existing.status === "Approved" ||
      existing.status === "Waitlisted" ||
      existing.status === "Rejected")
  ) {
    return { error: "You've already applied to this offering.", status: 409 };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    await lockOffering(tx, args.offeringId);

    // Review-required → Submitted. RSVP → seat if available, else waitlist.
    let status: EduApplicationStatus;
    let waitlistRank: number | null = null;
    if (offering.requiresReview) {
      status = "Submitted";
    } else if ((await approvedCount(tx, args.offeringId)) < offering.capacity) {
      status = "Approved";
    } else {
      status = "Waitlisted";
      waitlistRank = await nextWaitlistRank(tx, args.offeringId);
    }

    if (existing) {
      // Resubmit (Submitted) or re-apply (Withdrawn): refresh the answers on
      // the existing FormSubmission when there is one, else create it.
      let formSubmissionId = existing.formSubmissionId;
      if (formSubmissionId) {
        await tx.formSubmission.update({
          where: { id: formSubmissionId },
          data: {
            formVersionId: form.versionId,
            answers: args.answers as object,
          },
        });
      } else {
        const submission = await tx.formSubmission.create({
          data: {
            formId: form.formId,
            formVersionId: form.versionId,
            userId: args.userId,
            answers: args.answers as object,
            educationOfferingId: args.offeringId,
            slot: "application",
          },
          select: { id: true },
        });
        formSubmissionId = submission.id;
      }
      // A still-Submitted application keeps its status; a Withdrawn one
      // re-enters through the decision branch computed above.
      const nextStatus = existing.status === "Submitted" ? "Submitted" : status;
      await tx.educationApplication.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          waitlistRank: nextStatus === "Waitlisted" ? waitlistRank : null,
          formSubmissionId,
          submittedAt: new Date(),
        },
      });
      return { status: nextStatus, applicationId: existing.id };
    }

    const submission = await tx.formSubmission.create({
      data: {
        formId: form.formId,
        formVersionId: form.versionId,
        userId: args.userId,
        answers: args.answers as object,
        educationOfferingId: args.offeringId,
        slot: "application",
      },
      select: { id: true },
    });
    const created = await tx.educationApplication.create({
      data: {
        applicantUserId: args.userId,
        offeringId: args.offeringId,
        status,
        waitlistRank,
        formSubmissionId: submission.id,
      },
      select: { id: true },
    });
    return { status, applicationId: created.id };
  });

  await logAuditEvent({
    action: "education.application.submit",
    userId: args.userId,
    targetId: args.offeringId,
    metadata: { status: outcome.status },
  });
  // RSVP-style submits decide immediately — tell the applicant which way it
  // went. Review-required submits stay silent until an instructor decides.
  if (outcome.status === "Approved" || outcome.status === "Waitlisted") {
    await notifyApplicationStatus(outcome.applicationId);
  }
  return { ok: true, status: outcome.status };
}

export async function getMyApplication(userId: string, offeringId: string) {
  return prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: { applicantUserId: userId, offeringId },
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      waitlistRank: true,
      formSubmission: { select: { answers: true } },
    },
  });
}

/** Applications for the manage review tab, answers paired with their version's questions. */
export async function listApplications(offeringId: string) {
  return prisma.educationApplication.findMany({
    where: { offeringId },
    orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
    select: {
      id: true,
      status: true,
      submittedAt: true,
      waitlistRank: true,
      applicant: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          daliEmail: true,
          dartmouthEmail: true,
          netId: true,
        },
      },
      formSubmission: {
        select: {
          answers: true,
          formVersion: { select: { questions: true } },
        },
      },
    },
  });
}
