import type { ApplicationWhereInput } from "~/generated/prisma/models/Application";
import type { DomainApplicationWhereInput } from "~/generated/prisma/models/DomainApplication";

// Shared "in the review pipeline" filter — an application is in the review
// pipeline if it has been Submitted and has not been Withdrawn. Withdrawals
// are terminal today (no un-withdraw path; see portal.application.tsx), so a
// `NOT { some: Withdrawn }` check is sufficient. If un-withdraw is ever added,
// this needs to switch to a "latest status update is not Withdrawn" check.
export const inReviewPipelineFilter = {
  statusUpdates: { some: { newStatus: "Submitted" } },
  NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
} satisfies ApplicationWhereInput;

// A DomainApplication only belongs in the review pipeline once the applicant
// has actually submitted it. `inReviewPipelineFilter` above only sees the
// parent Application's status, so a domain added after that submission
// (its own submittedAt still null) needs this sibling check at the
// DomainApplication level — spread alongside, never inside, the filter above.
export const submittedDomainApplicationFilter = {
  submittedAt: { not: null },
} satisfies DomainApplicationWhereInput;

type StatusUpdateLike = { newStatus: string };

export function isWithdrawn(statusUpdates: StatusUpdateLike[]): boolean {
  return statusUpdates.some((u) => u.newStatus === "Withdrawn");
}

export function isInReviewPipeline(statusUpdates: StatusUpdateLike[]): boolean {
  const hasSubmitted = statusUpdates.some((u) => u.newStatus === "Submitted");
  return hasSubmitted && !isWithdrawn(statusUpdates);
}
