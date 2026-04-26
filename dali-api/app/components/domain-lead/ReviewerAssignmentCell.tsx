import { useState } from "react";
import { Plus, Trash2, Check, Clock, CircleDashed } from "lucide-react";
import { getReviewStatus } from "~/lib/review-status";
import { ReviewModal } from "./ReviewModal";

export function ReviewerAssignmentCell({ domainApplicationId, reviews, cycleReviewers, editable = true, rubricCriteria = [] }: {
  domainApplicationId: string | undefined;
  reviews: any[];
  cycleReviewers: any[];
  editable?: boolean;
  rubricCriteria?: any[];
}) {
  const [localReviews, setLocalReviews] = useState(reviews);
  const [adding, setAdding] = useState(false);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [openReview, setOpenReview] = useState<any | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const assignedReviewerIds = new Set(localReviews.map((r: any) => r.cycleReviewerId));
  const available = cycleReviewers.filter((cr: any) => !assignedReviewerIds.has(cr.id));

  async function addReviewer() {
    if (!domainApplicationId || !selectedReviewerId) return;
    try {
      const res = await fetch(`/api/domain-applications/${domainApplicationId}/reviews`, {
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
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to add reviewer:", res.status, err);
        alert(`Failed to add reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to add reviewer:", e);
    }
  }

  async function removeReview(reviewId: string, wasSubmitted: boolean) {
    if (wasSubmitted) {
      const ok = confirm("This reviewer has already submitted their review. Removing them will delete their scores and feedback. Continue?");
      if (!ok) return;
    }
    setRemoving(reviewId);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setLocalReviews(prev => prev.filter(r => r.id !== reviewId));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove review:", res.status, err);
        alert(`Failed to remove reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove review:", e);
      alert(`Failed to remove reviewer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {localReviews.map((r: any) => {
        const m = r.cycleReviewer?.daliMember;
        const name = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName[0]}.`
          : m?.daliEmail ?? "?";
        const status = getReviewStatus(r);
        const pillClass =
          status === "submitted"
            ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
            : status === "inProgress"
              ? "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
              : "border-gray-300 bg-muted/50 text-muted-foreground dark:border-gray-700 dark:bg-gray-800 dark:text-muted-foreground/70";
        const icon =
          status === "submitted" ? (
            <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
          ) : status === "inProgress" ? (
            <Clock className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
          ) : (
            <CircleDashed className="w-3 h-3 text-muted-foreground/70" />
          );
        return (
          <span
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpenReview(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenReview(r);
              }
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border cursor-pointer hover:brightness-95 transition ${pillClass}`}
          >
            {icon}
            {name}
            {editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeReview(r.id, status === "submitted");
                }}
                disabled={removing === r.id}
                className="ml-0.5 text-muted-foreground/70 hover:text-red-500 transition"
                title={status === "submitted" ? "Remove reviewer (deletes submitted review)" : "Remove reviewer"}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </span>
        );
      })}
      {editable && adding ? (
        <div className="inline-flex items-center gap-1">
          <select
            value={selectedReviewerId}
            onChange={e => setSelectedReviewerId(e.target.value)}
            className="rounded border border-border bg-card text-card-foreground px-1.5 py-0.5 text-xs"
          >
            <option value="">Select...</option>
            {available.map((cr: any) => {
              const m = cr.daliMember;
              const label = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? cr.id;
              return <option key={cr.id} value={cr.id}>{label}</option>;
            })}
          </select>
          <button
            onClick={addReviewer}
            disabled={!selectedReviewerId}
            className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setSelectedReviewerId(""); }}
            className="text-muted-foreground/70 hover:text-muted-foreground"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ) : editable ? (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border border-dashed border-gray-300 text-muted-foreground/70 hover:border-blue-400 hover:text-blue-600 transition"
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
