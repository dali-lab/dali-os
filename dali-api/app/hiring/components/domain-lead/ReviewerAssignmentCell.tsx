import { useState, useEffect } from "react";
import { useRevalidator } from "react-router";
import { Plus, Trash2 } from "lucide-react";
import { getReviewStatus } from "~/hiring/lib/review-status";
import { useToast } from "~/components/ui/toast";
import { Select, Tooltip } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { Pill, type PillTone } from "~/components/ui/Pill";
import { ReviewModal } from "~/hiring/components/domain-lead/ReviewModal";

export function ReviewerAssignmentCell({ domainApplicationId, reviews, cycleReviewers, editable = true, rubricCriteria = [] }: {
  domainApplicationId: string | undefined;
  reviews: any[];
  cycleReviewers: any[];
  editable?: boolean;
  rubricCriteria?: any[];
}) {
  const toast = useToast();
  const dialog = useDialog();
  const revalidator = useRevalidator();
  const [localReviews, setLocalReviews] = useState(reviews);
  const [adding, setAdding] = useState(false);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [openReview, setOpenReview] = useState<any | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // Resync from props after the loader revalidates (e.g. when bulk auto-assign
  // adds reviewers to this row). Without this, the pills shown here would lag
  // behind server state until a hard reload.
  useEffect(() => { setLocalReviews(reviews); }, [reviews]);

  const assignedReviewerIds = new Set(localReviews.map((r: any) => r.cycleReviewerId));
  const available = cycleReviewers.filter((cr: any) => !assignedReviewerIds.has(cr.id));

  async function addReviewer() {
    if (!domainApplicationId || !selectedReviewerId) return;
    try {
      const res = await fetch(`/api/hiring/domain-applications/${domainApplicationId}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleReviewerId: selectedReviewerId }),
      });
      if (res.ok) {
        const review = await res.json();
        const reviewer = cycleReviewers.find((cr: any) => cr.id === selectedReviewerId);
        setLocalReviews(prev => [...prev, { ...review, cycleReviewer: reviewer }]);
        setSelectedReviewerId("");
        setAdding(false);
        revalidator.revalidate();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to add reviewer:", res.status, err);
        toast.error(`Failed to add reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to add reviewer:", e);
    }
  }

  async function performRemoveReview(reviewId: string) {
    setRemoving(reviewId);
    try {
      const res = await fetch(`/api/hiring/reviews/${reviewId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setLocalReviews(prev => prev.filter(r => r.id !== reviewId));
        revalidator.revalidate();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove review:", res.status, err);
        toast.error(`Failed to remove reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove review:", e);
      toast.error(`Failed to remove reviewer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  async function requestRemoveReview(review: any) {
    const submitted = getReviewStatus(review) === "submitted";
    const m = review?.cycleReviewer?.user;
    const who =
      m?.firstName && m?.lastName
        ? `${m.firstName} ${m.lastName}`
        : (m?.daliEmail ?? "This reviewer");
    const ok = await dialog.confirm({
      title: submitted
        ? "Remove this reviewer's submitted review?"
        : "Remove this reviewer's in-progress review?",
      description: submitted
        ? `${who} has already submitted. Removing them permanently deletes their scores and feedback.`
        : `${who} has a review in progress. Removing them discards it.`,
      confirmLabel: submitted ? "Remove and delete review" : "Discard review",
      tone: "destructive",
    });
    if (!ok) return;
    await performRemoveReview(review.id);
  }

  const cellClass = editable && adding
    ? "flex flex-wrap items-center gap-1 rounded-os-item bg-os-well p-1.5"
    : "flex flex-wrap items-center gap-1";
  return (
    <div className={cellClass}>
      {localReviews.map((r: any) => {
        const m = r.cycleReviewer?.user;
        const name = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName[0]}.`
          : m?.daliEmail ?? "?";
        const fullName = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName}`
          : m?.daliEmail ?? "Reviewer";
        const status = getReviewStatus(r);
        const dot: PillTone =
          status === "submitted" ? "success" : status === "inProgress" ? "warning" : "neutral";
        const recommendation = r.overallRecommendation ? `, recommends ${r.overallRecommendation.toLowerCase()}` : "";
        const tooltip =
          status === "submitted"
            ? `${fullName} — submitted${recommendation}. Click to view scores and feedback.`
            : status === "inProgress"
              ? `${fullName} — review in progress. Click to view partial scores.`
              : `${fullName} — assigned but not started yet.`;
        return (
          <Tooltip key={r.id} content={tooltip} variant="rich">
          <span
            role="button"
            tabIndex={0}
            onClick={() => setOpenReview(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenReview(r);
              }
            }}
            aria-label={tooltip}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full transition-opacity hover:opacity-80"
          >
            <Pill dot={dot}>
            {name}
            {editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void requestRemoveReview(r);
                }}
                disabled={removing === r.id}
                className="ml-0.5 text-os-grey hover:text-destructive transition-colors"
                aria-label={status === "submitted" ? "Remove reviewer (deletes submitted review)" : "Remove reviewer"}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            </Pill>
          </span>
          </Tooltip>
        );
      })}
      {editable && adding ? (
        <div className="inline-flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide font-bold text-os-accent">
            Adding reviewer
          </span>
          <Select
            value={selectedReviewerId}
            placeholder="Select..."
            onChange={(v) => setSelectedReviewerId(v)}
            options={available.map((cr: any) => {
              const m = cr.user;
              return {
                value: cr.id as string,
                label: m?.firstName && m?.lastName
                  ? `${m.firstName} ${m.lastName}`
                  : m?.daliEmail ?? cr.id,
              };
            })}
            buttonClassName="rounded-full border border-os-container bg-os-card px-2.5 py-1 text-xs text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
          />
          <button
            onClick={addReviewer}
            disabled={!selectedReviewerId}
            className={buttonClasses("primary", "xs")}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setSelectedReviewerId(""); }}
            className={buttonClasses("ghost", "xs")}
          >
            Cancel
          </button>
        </div>
      ) : editable ? (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-os-container px-2.5 py-1 text-xs text-os-grey transition-colors hover:border-os-accent hover:text-os-accent"
          title="Add reviewer"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      ) : null}
      {openReview && (
        <ReviewModal
          review={openReview}
          rubricCriteria={rubricCriteria}
          onClose={() => setOpenReview(null)}
        />
      )}
    </div>
  );
}
