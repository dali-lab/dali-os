import { prisma } from "~/lib/db";
import { promoteFromWaitlist } from "./promotion.server";
import { notifyApplicationStatus } from "./notifications";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

export interface DecideInput {
  applicationId: string;
  targetStatus: EduApplicationStatus;
  actorUserId: string;
  /** Resolves to enrolledLink for the affected applicant. Defaults to `/education/enrolled/:offeringId`. */
  enrolledHrefFor?: (offeringId: string) => string;
}

export interface DecideOutcome {
  applicationId: string;
  previousStatus: EduApplicationStatus;
  newStatus: EduApplicationStatus;
  promotedApplicationId: string | null;
  promotedUserId: string | null;
}

/**
 * Apply a status transition to an EducationApplication and run the side
 * effects: waitlist promotion when a seat opens up, plus notifications to
 * the affected applicant and any promoted applicant. Returns null if the
 * application isn't found.
 */
export async function decideApplication(input: DecideInput): Promise<DecideOutcome | null> {
  const app = await prisma.educationApplication.findUnique({
    where: { id: input.applicationId },
    include: { offering: { select: { id: true, title: true } } },
  });
  if (!app) return null;

  const previousStatus = app.status;

  await prisma.educationApplication.update({
    where: { id: app.id },
    data: {
      status: input.targetStatus,
      reviewedAt: new Date(),
      reviewedBy: input.actorUserId,
    },
  });

  let promoted = { promotedApplicationId: null as string | null, promotedUserId: null as string | null };
  if (previousStatus === "Approved" && (input.targetStatus === "Withdrawn" || input.targetStatus === "Rejected")) {
    promoted = await promoteFromWaitlist(app.offering.id);
  }

  const baseLink = (input.enrolledHrefFor ?? ((id: string) => `/education/enrolled/${id}`))(app.offering.id);

  try {
    await notifyApplicationStatus({
      applicantUserId: app.applicantUserId,
      offeringTitle: app.offering.title,
      status: input.targetStatus,
      offeringId: app.offering.id,
      enrolledLink: input.targetStatus === "Approved" ? baseLink : null,
      reason: "decision",
    });
  } catch (err) {
    console.error("[education] decision notify failed:", err);
  }

  if (promoted.promotedApplicationId && promoted.promotedUserId) {
    try {
      await notifyApplicationStatus({
        applicantUserId: promoted.promotedUserId,
        offeringTitle: app.offering.title,
        status: "Approved",
        offeringId: app.offering.id,
        enrolledLink: `/education/enrolled/${app.offering.id}`,
        reason: "waitlist_promoted",
      });
    } catch (err) {
      console.error("[education] promotion notify failed:", err);
    }
  }

  return {
    applicationId: app.id,
    previousStatus,
    newStatus: input.targetStatus,
    promotedApplicationId: promoted.promotedApplicationId,
    promotedUserId: promoted.promotedUserId,
  };
}
