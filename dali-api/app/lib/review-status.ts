// Derived review lifecycle used by both the reviewer dashboard and the
// domain-lead applicant pills. The schema only stores `submittedAt`, so
// "notStarted" vs "inProgress" is a UI-level derivation from whether any
// content fields have been touched since the row was created.

export type ReviewStatus = "notStarted" | "inProgress" | "submitted";

type ReviewLike = {
  submittedAt?: Date | string | null;
  feedback?: string | null;
  rejectionRationale?: string | null;
  overallRecommendation?: string | null;
  scores?: unknown;
  annotations?: unknown;
};

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isNonEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function getReviewStatus(review: ReviewLike): ReviewStatus {
  if (review.submittedAt) return "submitted";
  const hasContent =
    isNonEmptyString(review.feedback) ||
    isNonEmptyString(review.rejectionRationale) ||
    isNonEmptyString(review.overallRecommendation) ||
    isNonEmptyObject(review.scores) ||
    isNonEmptyArray(review.annotations);
  return hasContent ? "inProgress" : "notStarted";
}
