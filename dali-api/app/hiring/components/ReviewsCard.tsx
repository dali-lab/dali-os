import type { ReactNode } from "react";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { DetailCard } from "~/hiring/components/DetailCard";
import { ReviewSummary } from "~/hiring/components/ReviewSummary";

export type ReviewsCardReview = {
  id: string;
  reviewerName: string;
  reviewerPhotoUrl?: string | null;
  overallRecommendation?: string | null;
  scores?: Record<string, number> | null;
  feedback?: string | null;
  rejectionRationale?: string | null;
  submittedAt?: string | Date | null;
};

// The submitted reviews beside an applicant's application, one at a time
// behind a reviewer picker. The applicant page and the interview page share it.
export function ReviewsCard({
  reviews,
  criteria,
  selectedId,
  onSelect,
  footerSuffix,
}: {
  reviews: ReviewsCardReview[];
  criteria: Record<string, { label: string; maxScore?: number }>;
  selectedId: string | null;
  onSelect: (reviewId: string) => void;
  /** Appended to the "Submitted …" line under the selected review. */
  footerSuffix?: ReactNode;
}) {
  const { formTrigger } = useOsChrome();
  const selected = reviews.find((r) => r.id === selectedId) ?? reviews[0] ?? null;
  return (
    <DetailCard
      title="Reviews"
      subtitle={reviews.length === 0 ? "No submitted reviews yet." : `${reviews.length} submitted`}
      className="lg:sticky lg:top-24"
    >
      {selected && (
        <div className="px-6 pb-6 space-y-5">
          <div>
            <span className="os-field-label mb-1.5 block">Reviewer</span>
            <Select
              ariaLabel="Reviewer"
              value={selected.id}
              onChange={onSelect}
              options={reviews.map((r) => ({ value: r.id, label: r.reviewerName }))}
              buttonClassName={formTrigger}
            />
          </div>
          <ReviewSummary
            reviewerName={selected.reviewerName}
            reviewerPhotoUrl={selected.reviewerPhotoUrl}
            overallRecommendation={selected.overallRecommendation}
            scores={selected.scores ?? undefined}
            criteria={criteria}
            feedback={selected.feedback}
            rejectionRationale={selected.rejectionRationale}
            footerNote={
              selected.submittedAt ? (
                <>
                  Submitted{" "}
                  {new Date(selected.submittedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  .{footerSuffix}
                </>
              ) : null
            }
          />
        </div>
      )}
    </DetailCard>
  );
}
