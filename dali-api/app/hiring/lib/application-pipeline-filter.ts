import type { ApplicationWhereInput } from "~/generated/prisma/models/Application";

// Shared "in the review pipeline" filter — an application is in the review
// pipeline if it has been Submitted and has not been Withdrawn. Withdrawals
// are terminal today (no un-withdraw path; see portal.application.tsx), so a
// `NOT { some: Withdrawn }` check is sufficient. If un-withdraw is ever added,
// this needs to switch to a "latest status update is not Withdrawn" check.
export const inReviewPipelineFilter = {
  statusUpdates: { some: { newStatus: "Submitted" } },
  NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
} satisfies ApplicationWhereInput;

type StatusUpdateLike = { newStatus: string };

export function isWithdrawn(statusUpdates: StatusUpdateLike[]): boolean {
  return statusUpdates.some((u) => u.newStatus === "Withdrawn");
}

export function isInReviewPipeline(statusUpdates: StatusUpdateLike[]): boolean {
  const hasSubmitted = statusUpdates.some((u) => u.newStatus === "Submitted");
  return hasSubmitted && !isWithdrawn(statusUpdates);
}
