export type SubmissionAction = "submit" | "unsubmit";

export async function changeReviewSubmission({
  reviewId,
  action,
  flushSave,
  revalidate,
  onError,
}: {
  reviewId: string;
  action: SubmissionAction;
  flushSave: () => Promise<unknown> | unknown;
  revalidate: () => void;
  onError: (message: string) => void;
}) {
  if (action === "submit") await flushSave();
  const res = await fetch(`/api/hiring/reviews/${reviewId}/${action}`, { method: "POST", credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    onError(body?.error ?? (action === "submit" ? "Could not submit the review" : "Could not unsubmit the review"));
    return;
  }
  revalidate();
}
