import { useState } from "react";
import { useRevalidator } from "react-router";
import { Check, HelpCircle, X as XIcon } from "lucide-react";
import { TASKS_CHANGED_EVENT } from "~/components/NotificationBell";
import { buttonClasses, type ButtonSize } from "~/components/ui/Button";
import { cn } from "~/lib/cn";

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
  size = "xs",
  className = "mt-2 gap-1",
}: {
  notificationId: string;
  onResponded?: (rsvp: "Accepted" | "Declined" | "Tentative") => void;
  size?: ButtonSize;
  className?: string;
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

  const iconCls = size === "xs" ? "w-3 h-3" : "w-4 h-4";

  return (
    <>
      <div className={cn("flex flex-wrap items-center", className)}>
        <button
          type="button"
          onClick={() => sendRsvp("accepted")}
          disabled={!!submitting}
          className={buttonClasses("primary", size, "gap-1")}
        >
          <Check className={iconCls} />
          {submitting === "accepted" ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={() => sendRsvp("tentative")}
          disabled={!!submitting}
          className={buttonClasses("secondary", size, "gap-1")}
        >
          <HelpCircle className={iconCls} />
          {submitting === "tentative" ? "…" : "Maybe"}
        </button>
        <button
          type="button"
          onClick={() => sendRsvp("declined")}
          disabled={!!submitting}
          className={buttonClasses("secondary", size, "gap-1")}
        >
          <XIcon className={iconCls} />
          {submitting === "declined" ? "…" : "Decline"}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-700 mt-1">{error}</p>}
    </>
  );
}
