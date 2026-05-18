import { prisma } from "~/lib/db";
import { emitEvent } from "~/lib/notifications";
import { sendDecisionEmail } from "./email";
import { syncSessionRoster } from "./roster-sync";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

// The single funnel for all EducationApplication state transitions. Apply,
// Approve, Reject, Waitlist, and Withdraw all converge here so the waitlist-
// promotion + calendar-sync + notification fan-out logic lives in one place.

export type DecisionAction =
  | "Approve"
  | "Reject"
  | "Waitlist"
  | "Withdraw"
  | "AutoApprove";

export interface DecisionInput {
  applicationId: string;
  action: DecisionAction;
  /** The actor making the decision. For Withdraw, this is the applicant. */
  actorUserId: string;
  /**
   * Optional free-form note shown in the decision email. The persistent
   * reviewer note lives in the per-application collab doc; this is a
   * convenience for fast decisions without opening the editor.
   */
  reviewerNote?: string | null;
}

export interface DecisionResult {
  applicationId: string;
  newStatus: EduApplicationStatus;
  promotedApplicationId: string | null;
}

function actionToStatus(action: DecisionAction): EduApplicationStatus {
  switch (action) {
    case "Approve":
    case "AutoApprove":
      return "Approved";
    case "Reject":
      return "Rejected";
    case "Waitlist":
      return "Waitlisted";
    case "Withdraw":
      return "Withdrawn";
  }
}

/**
 * Apply a decision and (when capacity allows) promote the next waitlisted
 * applicant in a single transaction. Side effects (notification fan-out,
 * email send, calendar sync) run after the transaction commits.
 */
export async function decide(input: DecisionInput): Promise<DecisionResult> {
  const newStatus = actionToStatus(input.action);

  const { app, promoted, offering } = await prisma.$transaction(async (tx) => {
    const existing = await tx.educationApplication.findUnique({
      where: { id: input.applicationId },
      include: {
        offering: {
          select: {
            id: true,
            title: true,
            capacity: true,
            requiresReview: true,
          },
        },
      },
    });
    if (!existing) throw new Error("Application not found");

    const wasApproved = existing.status === "Approved";

    const updated = await tx.educationApplication.update({
      where: { id: input.applicationId },
      data: {
        status: newStatus,
        reviewedAt: input.action === "Withdraw" ? existing.reviewedAt : new Date(),
        reviewedBy: input.action === "Withdraw" ? existing.reviewedBy : input.actorUserId,
      },
    });

    let promotedApp: { id: string; applicantUserId: string } | null = null;

    // Promotion only triggers when a previously-Approved slot has just been
    // freed (Reject or Withdraw from Approved). Rejecting a Submitted /
    // Waitlisted applicant doesn't free a seat.
    const freedSlot = wasApproved && newStatus !== "Approved";
    if (freedSlot) {
      const currentApproved = await tx.educationApplication.count({
        where: { offeringId: existing.offeringId, status: "Approved" },
      });
      if (currentApproved < existing.offering.capacity) {
        const next = await tx.educationApplication.findFirst({
          where: { offeringId: existing.offeringId, status: "Waitlisted" },
          orderBy: { submittedAt: "asc" },
          select: { id: true, applicantUserId: true },
        });
        if (next) {
          await tx.educationApplication.update({
            where: { id: next.id },
            data: {
              status: "Approved",
              reviewedAt: new Date(),
              reviewedBy: input.actorUserId,
            },
          });
          promotedApp = next;
        }
      }
    }

    return { app: updated, promoted: promotedApp, offering: existing.offering };
  });

  // Side effects — best-effort, post-commit.
  await Promise.allSettled([
    notifyDecision(app.applicantUserId, offering, newStatus, input),
    promoted
      ? notifyPromoted(promoted.applicantUserId, offering)
      : Promise.resolve(),
    syncSessionRoster(offering.id).catch((err) => {
      console.error("[education:decisions] roster sync failed", err);
    }),
  ]);

  return {
    applicationId: app.id,
    newStatus,
    promotedApplicationId: promoted?.id ?? null,
  };
}

async function notifyDecision(
  applicantUserId: string,
  offering: { id: string; title: string },
  status: EduApplicationStatus,
  input: DecisionInput,
): Promise<void> {
  // Skip notification on self-withdraw (the user knows they did it).
  if (input.action === "Withdraw") return;
  // Skip the "Submitted" non-decision case (apply confirmation handled
  // separately; decide() doesn't reach this branch for AutoApprove either
  // because AutoApprove → Approved).
  if (status === "Submitted") return;

  await emitEvent({
    type: `education.application_${status.toLowerCase()}`,
    recipients: [applicantUserId],
    payload: { offeringId: offering.id, status },
    inbox: {
      kind: "EducationApplicationDecision",
      title: `${offering.title}: ${status}`,
      body: input.reviewerNote ?? null,
      link: `/portal/education/applications/${input.applicationId}`,
      createdByUserId: input.actorUserId,
    },
  });

  const recipient = await loadRecipient(applicantUserId);
  if (recipient) {
    await sendDecisionEmail({
      to: recipient,
      offeringTitle: offering.title,
      status,
      reviewerNote: input.reviewerNote ?? null,
    });
  }
}

async function notifyPromoted(
  applicantUserId: string,
  offering: { id: string; title: string },
): Promise<void> {
  await emitEvent({
    type: "education.waitlist_promoted",
    recipients: [applicantUserId],
    payload: { offeringId: offering.id },
    inbox: {
      kind: "EducationWaitlistPromoted",
      title: `You're off the waitlist for ${offering.title}!`,
      body: "A spot opened up and you've been promoted to approved.",
      link: `/portal/education/${offering.id}`,
    },
  });
  // Per scope: no email on auto-promote. In-app notif only.
}

async function loadRecipient(
  applicantUserId: string,
): Promise<{ email: string; firstName: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: applicantUserId },
    select: {
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
    },
  });
  if (!user) return null;
  const email = user.daliEmail ?? user.dartmouthEmail;
  if (!email) return null;
  return { email, firstName: user.firstName };
}
