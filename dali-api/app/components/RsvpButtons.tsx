import { useState } from "react";
import { useRevalidator } from "react-router";
import { Check, HelpCircle, X as XIcon } from "lucide-react";
import { TASKS_CHANGED_EVENT } from "~/components/NotificationBell";
import { buttonClasses } from "~/components/ui/Button";

// Tell the shell's sidebar task poller that the task list changed. Inside a
// TabWorkspace iframe the poller lives in the parent, so relay via postMessage;
// the shell re-dispatches it as a same-window event (see Layout.tsx).
export function notifyTasksChanged() {
  if (window.self !== window.top) {
    window.parent.postMessage(
      { type: "dali:tasksChanged" },
      window.location.origin,
    );
  } else {
    window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
  }
}

/**
 * Accept / Maybe / Decline for a MeetingInvite notification. POSTs to the
 * RSVP endpoint (records attendance + marks the notification read), then
 * revalidates so the answered invite drops out of open tasks.
 */
export function RsvpButtons({
  notificationId,
  onResponded,
}: {
  notificationId: string;
  onResponded?: (rsvp: "Accepted" | "Declined" | "Tentative") => void;
}) {
  const revalidator = useRevalidator();
  const [submitting, setSubmitting] = useState<
    null | "accepted" | "declined" | "tentative"
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function sendRsvp(response: "accepted" | "declined" | "tentative") {
    setSubmitting(response);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${notificationId}/rsvp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to RSVP");
        return;
      }
      const enumVal =
        response === "accepted"
          ? "Accepted"
          : response === "declined"
            ? "Declined"
            : "Tentative";
      onResponded?.(enumVal);
      if (json.gcalError) {
        setError(`Recorded in-app, but Google sync failed: ${json.gcalError}`);
      } else {
        revalidator.revalidate();
        notifyTasksChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => sendRsvp("accepted")}
          disabled={!!submitting}
          className={buttonClasses("primary", "sm", "gap-1")}
        >
          <Check className="w-3 h-3" />
          {submitting === "accepted" ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={() => sendRsvp("tentative")}
          disabled={!!submitting}
          className={buttonClasses("secondary", "sm", "gap-1")}
        >
          <HelpCircle className="w-3 h-3" />
          {submitting === "tentative" ? "…" : "Maybe"}
        </button>
        <button
          type="button"
          onClick={() => sendRsvp("declined")}
          disabled={!!submitting}
          className={buttonClasses("secondary", "sm", "gap-1")}
        >
          <XIcon className="w-3 h-3" />
          {submitting === "declined" ? "…" : "Decline"}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-700 mt-1">{error}</p>}
    </>
  );
}
