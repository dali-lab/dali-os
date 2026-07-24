// Read-only summary of a submitted application review: reviewer name,
// recommendation badge, per-criterion scores, feedback, and rejection
// rationale. Shared by the applications-database detail page, the domain-lead
// dashboard, and the interviewer page, which each wrap it in their own chrome.

import { Avatar } from "~/components/ui/Avatar";

const DEFAULT_RECOMMENDATION_TONE: Record<string, string> = {
  "Strong Hire": "bg-green-100 text-green-800",
  Hire: "bg-green-50 text-green-700",
  "Lean Hire": "bg-lime-50 text-lime-700",
  "Lean No Hire": "bg-amber-50 text-amber-700",
  "No Hire": "bg-red-50 text-red-700",
};

export interface ReviewSummaryProps {
  reviewerName?: string;
  reviewerPhotoUrl?: string | null;
  submittedAt?: string | Date | null;
  overallRecommendation?: string | null;
  // Maps a recommendation value to its badge classes. Defaults to a
  // green→red scale; pass a custom map to match a page's existing palette.
  recommendationTone?: Record<string, string>;
  scores?: Record<string, number>;
  // Criterion key → display label (and optional max score for "n/max").
  criteria?: Record<string, { label: string; maxScore?: number }>;
  feedback?: string | null;
  rejectionRationale?: string | null;
  // Rendered at the bottom (e.g. the applications page's "submitted on …"
  // note). Kept generic so each page controls its own footer copy.
  footerNote?: React.ReactNode;
}

export function ReviewSummary({
  reviewerName,
  reviewerPhotoUrl,
  submittedAt,
  overallRecommendation,
  recommendationTone = DEFAULT_RECOMMENDATION_TONE,
  scores,
  criteria = {},
  feedback,
  rejectionRationale,
  footerNote,
}: ReviewSummaryProps) {
  const scoreEntries = Object.entries(scores ?? {});
  const showHeader = !!reviewerName || !!submittedAt;

  return (
    <div className="space-y-5">
      {showHeader && (
        <div className="flex items-center gap-2">
          {reviewerName && (
            <Avatar photoUrl={reviewerPhotoUrl} name={reviewerName} size="sm" className="shrink-0" />
          )}
          <div>
            {reviewerName && (
              <div className="text-sm font-semibold text-foreground">{reviewerName}</div>
            )}
            {submittedAt && (
              <div className="text-xs text-muted-foreground">
                Submitted{" "}
                {new Date(submittedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {overallRecommendation && (
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Overall Recommendation
          </h3>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium ${
              recommendationTone[overallRecommendation] ?? "bg-muted text-foreground"
            }`}
          >
            {overallRecommendation}
          </span>
        </div>
      )}

      {scoreEntries.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Scores
          </h3>
          <ul className="space-y-1">
            {scoreEntries.map(([key, value]) => {
              const criterion = criteria[key];
              return (
                <li
                  key={key}
                  className="flex items-center justify-between text-sm border-b border-border/60 py-1"
                >
                  <span className="text-muted-foreground">{criterion?.label ?? key}</span>
                  <span className="font-medium text-foreground">
                    {criterion?.maxScore != null ? `${value}/${criterion.maxScore}` : value}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {feedback?.trim() && (
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Internal Feedback
          </h3>
          <p className="text-sm text-foreground whitespace-pre-wrap">{feedback}</p>
        </div>
      )}

      {rejectionRationale?.trim() && (
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
            Rejection Rationale
          </h3>
          <p className="text-sm text-foreground whitespace-pre-wrap">{rejectionRationale}</p>
        </div>
      )}

      {footerNote && (
        <p className="text-[11px] text-muted-foreground/70 pt-2 border-t border-border">
          {footerNote}
        </p>
      )}
    </div>
  );
}
