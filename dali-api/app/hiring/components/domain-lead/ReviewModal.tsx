import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { RECOMMENDATION_TONES } from "~/hiring/lib/labels";
import { Pill } from "~/components/ui/Pill";

export function ReviewModal({ review, rubricCriteria, onClose }: {
  review: any;
  rubricCriteria: any[];
  onClose: () => void;
}) {
  const m = review.cycleReviewer?.user;
  const reviewerName = m?.firstName && m?.lastName
    ? `${m.firstName} ${m.lastName}`
    : m?.daliEmail ?? "Reviewer";
  const isSubmitted = !!review.submittedAt;
  const scoreEntries = Object.entries((review.scores as Record<string, number>) ?? {});
  const criteriaByKey: Record<string, { label: string; description?: string; maxScore?: number }> = {};
  for (const c of rubricCriteria ?? []) {
    if (c?.key) criteriaByKey[c.key] = { label: c.label ?? c.key, description: c.description, maxScore: c.maxScore };
  }

  const hasAnyContent =
    scoreEntries.length > 0 ||
    (review.feedback && review.feedback.trim() !== "") ||
    (review.rejectionRationale && review.rejectionRationale.trim() !== "") ||
    !!review.overallRecommendation;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="reviewer-detail-title"
      containerClassName="relative bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto my-auto"
    >
      <>
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 id="reviewer-detail-title" className="text-lg font-semibold text-foreground">{reviewerName}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs">
              {isSubmitted ? (
                <Pill dot="success">
                  Submitted
                  {review.submittedAt && (
                    <> · {new Date(review.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
                  )}
                </Pill>
              ) : (
                <Pill dot="warning">In progress</Pill>
              )}
              {review.overallRecommendation && (
                <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? "neutral"}>
                  {review.overallRecommendation}
                </Pill>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!hasAnyContent ? (
            <p className="text-sm text-muted-foreground italic">
              This reviewer hasn&apos;t started their review yet.
            </p>
          ) : (
            <>
              {review.overallRecommendation && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Recommendation
                  </h3>
                  <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? "neutral"}>
                    {review.overallRecommendation}
                  </Pill>
                </div>
              )}
              {scoreEntries.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Scores
                  </h3>
                  <div className="space-y-2">
                    {scoreEntries.map(([key, score]) => {
                      const criterion = criteriaByKey[key];
                      return (
                        <div key={key} className="bg-muted/50 rounded px-3 py-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-foreground/80">
                              {criterion?.label ?? key}
                            </span>
                            <span className="font-semibold text-foreground whitespace-nowrap">
                              {score}
                              {criterion?.maxScore != null && (
                                <span className="font-normal text-muted-foreground"> / {criterion.maxScore}</span>
                              )}
                            </span>
                          </div>
                          {criterion?.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{criterion.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {review.feedback && review.feedback.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Feedback
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.feedback}
                  </p>
                </div>
              )}
              {review.rejectionRationale && review.rejectionRationale.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Rejection rationale
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.rejectionRationale}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </>
    </Modal>
  );
}
