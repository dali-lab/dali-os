import { prisma } from "~/lib/db";

export interface PromotionResult {
  promotedApplicationId: string | null;
  promotedUserId: string | null;
}

/**
 * If the offering has fewer Approved applicants than its capacity and one or
 * more Waitlisted applicants exist, promote the oldest Waitlisted applicant
 * (FIFO by submittedAt) to Approved and return their info. Returns null fields
 * when nothing was promoted.
 *
 * Caller is responsible for sending the notification email — kept separate so
 * the data mutation can be unit-tested without email infrastructure.
 */
export async function promoteFromWaitlist(offeringId: string): Promise<PromotionResult> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: { id: true, capacity: true },
  });
  if (!offering) return { promotedApplicationId: null, promotedUserId: null };

  const approvedCount = await prisma.educationApplication.count({
    where: { offeringId, status: "Approved" },
  });
  if (approvedCount >= offering.capacity) {
    return { promotedApplicationId: null, promotedUserId: null };
  }

  const next = await prisma.educationApplication.findFirst({
    where: { offeringId, status: "Waitlisted" },
    orderBy: [{ waitlistRank: { sort: "asc", nulls: "last" } }, { submittedAt: "asc" }],
    select: { id: true, applicantUserId: true },
  });
  if (!next) return { promotedApplicationId: null, promotedUserId: null };

  await prisma.educationApplication.update({
    where: { id: next.id },
    data: { status: "Approved", reviewedAt: new Date() },
  });

  return { promotedApplicationId: next.id, promotedUserId: next.applicantUserId };
}
