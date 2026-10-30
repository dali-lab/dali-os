import { useState } from "react";
import { useRevalidator } from "react-router";
import { Check, HelpCircle, X as XIcon } from "lucide-react";
import { TASKS_CHANGED_EVENT } from "~/components/NotificationBell";
import { buttonClasses, type ButtonSize } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
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

type Answer = "accepted" | "declined" | "tentative";

const ANSWER_LABEL = { accepted: "Accepted", declined: "Declined", tentative: "Tentative" } as const;

/**
 * Going / Maybe / Can't make it for a MeetingInvite notification. The chosen
 * answer shows at once; the POST to the RSVP endpoint (records attendance +
 * marks the notification read) and the revalidation that drops the answered
 * invite from open tasks follow. A failed POST takes the answer back and says why.
 */
export function RsvpButtons({
  notificationId,
  onResponded,
  onFailed,
  onSaved,
  size = "xs",
  className = "mt-2 gap-1",
}: {
  notificationId: string;
  onResponded?: (rsvp: "Accepted" | "Declined" | "Tentative") => void;
  onFailed?: () => void;
  onSaved?: () => void;
  size?: ButtonSize;
  className?: string;
}) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const [chosen, setChosen] = useState<Answer | null>(null);

  async function sendRsvp(response: Answer) {
    setChosen(response);
    onResponded?.(ANSWER_LABEL[response]);
    const fail = (message: string) => {
      setChosen(null);
      onFailed?.();
      toast.error(message);
    };
    try {
      const res = await fetch(`/api/notifications/${notificationId}/rsvp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) {
        fail(json.error ?? "Failed to RSVP");
        return;
      }
      if (json.gcalError) toast.error(`Recorded in-app, but Google sync failed: ${json.gcalError}`);
      onSaved?.();
      await revalidator.revalidate();
      notifyTasksChanged();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Network error");
    }
  }

  const iconCls = size === "xs" ? "w-3 h-3" : "w-4 h-4";
  const options: { answer: Answer; label: string; Icon: typeof Check }[] = [
    { answer: "accepted", label: "Going", Icon: Check },
    { answer: "tentative", label: "Maybe", Icon: HelpCircle },
    { answer: "declined", label: "Can't make it", Icon: XIcon },
  ];

  return (
    <div className={cn("flex flex-wrap items-center", className)}>
      {options.map(({ answer, label, Icon }) => (
        <button
          key={answer}
          type="button"
          onClick={() => sendRsvp(answer)}
          disabled={chosen !== null}
          aria-pressed={chosen === answer}
          className={buttonClasses((chosen ?? "accepted") === answer ? "primary" : "secondary", size, "gap-1")}
        >
          <Icon className={iconCls} />
          {label}
        </button>
      ))}
    </div>
  );
}
