import { useState, type MouseEvent } from "react";
import { useRevalidator } from "react-router";
import { Check, ExternalLink, CalendarClock, X } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { RsvpButtons, notifyTasksChanged } from "~/components/RsvpButtons";
import { buttonClasses } from "~/components/ui/Button";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
// The client mirror of ~/lib/tasks' `Task`, so the shell's panel pulls in no
// server code (see NotificationBell).
import type { OpenTask } from "~/components/NotificationBell";

/* ------------------------------------------------------------------ */
/* The attention stack: open tasks plus notifications (incl. meeting-   */
/* invite RSVP) still waiting on the user. Lives in the shell's bell    */
/* panel — it used to be a banner on Home, but the front door is not    */
/* where you look for a thing you have to answer, and the bell is       */
/* reachable from every route.                                          */
/*                                                                      */
/* Poll-driven, not loader-driven: the shell feeds it from the same      */
/* /api/notifications poll that backs the bell's count (see             */
/* NotificationBell), so acting on a card converges through             */
/* notifyTasksChanged() rather than a route revalidation.               */
/* ------------------------------------------------------------------ */

// One feed row, as /api/notifications returns it. Mirrors the fields the
// cards render — kept local so this client module imports no server code.
export type AttentionNotification = {
  id: string;
  kind: "General" | "MeetingInvite" | "MeetingReminder" | "SystemAnnouncement" | "Education";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  scheduledMeetingId: string | null;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
};

// How the panel opens a link. The shell passes its workspace opener so a task
// lands in a real tab; omitted, the link navigates (or asks the parent shell
// for a tab when rendered inside a TabWorkspace iframe).
export type OpenLink = (url: string, label: string) => void;

function openTarget(
  e: MouseEvent<HTMLAnchorElement>,
  link: string,
  label: string,
  onOpen?: OpenLink,
) {
  if (onOpen) {
    e.preventDefault();
    onOpen(link, label);
    return;
  }
  if (link.startsWith("/") && requestOpenTabIfEmbedded(link, label)) {
    e.preventDefault();
  }
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Tasks are themselves notification rows (Task.id === Notification.id), so a
// task (e.g. an announcement-todo) also appears in the raw feed. Drop those
// duplicates — the task card is the richer rendering (deadline + form link) —
// so each item shows once.
//
// A read notification still belongs here only when it's a meeting invite: we
// keep those so the RSVP/status badge stays reachable. Every other read
// notification (e.g. an interview assignment already opened, so it's no longer
// a task) is finished business — its Dismiss can't change anything
// server-side, so the card would just sit here un-clearable. An answered
// invite is done too, and shows its verdict on the task list instead.
export function extraNotifications(
  tasks: OpenTask[],
  notifications: AttentionNotification[],
): AttentionNotification[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  return notifications.filter((n) => {
    if (taskIds.has(n.id)) return false;
    if (n.readAt && n.kind !== "MeetingInvite") return false;
    if (n.scheduledMeetingId && n.rsvp) return false;
    return true;
  });
}

/** True when there is at least one card to show. */
export function hasAttentionContent(
  tasks: OpenTask[],
  notifications: AttentionNotification[],
): boolean {
  return tasks.length > 0 || extraNotifications(tasks, notifications).length > 0;
}

/** Count for the bell badge and the panel header: open tasks + unread extras. */
export function attentionCount(
  tasks: OpenTask[],
  notifications: AttentionNotification[],
): number {
  const unread = extraNotifications(tasks, notifications).filter(
    (n) => !n.readAt,
  ).length;
  return tasks.length + unread;
}

export function AttentionPanel({
  tasks,
  notifications,
  onOpen,
}: {
  tasks: OpenTask[];
  notifications: AttentionNotification[];
  onOpen?: OpenLink;
}) {
  const extras = extraNotifications(tasks, notifications);
  const count = attentionCount(tasks, notifications);

  if (tasks.length === 0 && extras.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        You&apos;re all caught up.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="font-heading text-sm font-semibold text-foreground">
        {count > 0
          ? `${count} ${count === 1 ? "item needs" : "items need"} your attention`
          : "Your notifications"}
      </span>

      {tasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </div>
      )}

      {extras.length > 0 && (
        <div
          className={`flex flex-col gap-2 ${tasks.length > 0 ? "border-t border-border pt-3" : ""}`}
        >
          {extras.map((n) => (
            <NotificationCard key={n.id} notification={n} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Task card. Three shapes, by how the task clears:                     */
/*   - meeting invite  → RSVP buttons (Accept/Maybe/Decline)             */
/*   - has an attached form (hasAction + link) → link to the form; the   */
/*     submit marks it read, so no Confirm                               */
/*   - everything else → its link (if any) plus a Confirm button that    */
/*     marks the notification read. A bare link doesn't self-clear, so   */
/*     Confirm is how the user says "handled".                           */
/* ------------------------------------------------------------------ */

function TaskCard({ task: t, onOpen }: { task: OpenTask; onOpen?: OpenLink }) {
  const revalidator = useRevalidator();
  const { confirm: confirmDialog } = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  // Same full-width card as NotificationCard below. The tasks used to be a
  // horizontal strip of fixed-width tiles, which clipped a row of actions
  // (Accept / Maybe / Decline) at the tile's border.
  const cls =
    "block bg-card border border-border shadow-brand-1 border-l-4 border-l-accent-coral rounded-md px-3 py-2.5";

  const meta = t.dueAt ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-coral mt-1">
      <CalendarClock className="w-3 h-3" />
      {formatDeadline(t.dueAt)}
    </span>
  ) : (
    <span className="block text-[11px] text-muted-foreground mt-1">
      {t.source === "meeting" ? "Awaiting your response" : "Action needed"}
    </span>
  );

  const title = (
    <span className="block text-sm font-semibold text-foreground truncate">
      {t.title}
    </span>
  );

  // Meeting invites clear only on RSVP, never on a click — Accept/Maybe/Decline
  // inline. The RSVP revalidates, dropping the answered invite.
  if (t.source === "meeting") {
    return (
      <div className={cls}>
        {title}
        {meta}
        <RsvpButtons notificationId={t.id} />
      </div>
    );
  }

  // A form todo self-clears on submit, so the tile links to the form. But a
  // recipient who won't (or can't) fill it would otherwise be stuck with it
  // forever — the /read endpoint refuses a plain read — so offer a confirmed
  // Dismiss that clears the reminder without submitting (intent=dismiss).
  async function dismissForm() {
    const ok = await confirmDialog({
      title: "Dismiss this reminder?",
      description:
        "You haven't submitted this form. Dismissing removes it from your tasks — you can still find it in History.",
      confirmLabel: "Dismiss",
    });
    if (!ok) return;
    setDismissing(true);
    try {
      await fetch(`/api/notifications/${t.id}/read`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "dismiss" }),
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setDismissing(false);
    }
  }

  if (t.formTodo) {
    return (
      <div className={cls}>
        <a
          href={t.link!}
          onClick={(e) => openTarget(e, t.link!, t.title, onOpen)}
          className="block hover:opacity-80 transition-opacity"
        >
          {title}
          {meta}
        </a>
        <button
          type="button"
          onClick={dismissForm}
          disabled={dismissing}
          className={buttonClasses("secondary", "sm", "mt-2 gap-1")}
        >
          <X className="w-3 h-3" />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    );
  }

  // Other self-clearing tasks that merely link (onboarding, an apply-to-cycle
  // task): the whole tile is the link and there's no Confirm.
  if (t.hasAction && t.link) {
    return (
      <a
        href={t.link}
        onClick={(e) => openTarget(e, t.link!, t.title, onOpen)}
        className={`${cls} hover:border-accent-coral/50 transition-colors`}
      >
        {title}
        {meta}
      </a>
    );
  }

  // Everything else: a Confirm button marks the task read. If it also carries
  // a link, expose it as a separate "Open" affordance so navigating and
  // confirming stay distinct actions.
  async function confirm() {
    setConfirming(true);
    try {
      await fetch(`/api/notifications/${t.id}/read`, {
        method: "POST",
        credentials: "include",
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setConfirming(false);
    }
  }

  return (
    <div className={cls}>
      {title}
      {meta}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={confirm}
          disabled={confirming}
          className={buttonClasses("primary", "sm", "gap-1")}
        >
          <Check className="w-3 h-3" />
          {confirming ? "Confirming…" : "Confirm"}
        </button>
        {t.link && (
          <a
            href={t.link}
            onClick={(e) => openTarget(e, t.link!, t.title, onOpen)}
            className={buttonClasses("secondary", "sm", "gap-1")}
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notification card                                                    */
/* ------------------------------------------------------------------ */

function NotificationCard({
  notification,
  onOpen,
}: {
  notification: AttentionNotification;
  onOpen?: OpenLink;
}) {
  const revalidator = useRevalidator();
  const isUnread = !notification.readAt;
  const isInvite =
    notification.kind === "MeetingInvite" && !!notification.scheduledMeetingId;
  const accent = isUnread ? "border-l-accent-coral" : "border-l-accent-teal";
  const [rsvp, setRsvp] = useState<AttentionNotification["rsvp"]>(notification.rsvp);
  const [dismissing, setDismissing] = useState(false);

  // Invites clear by RSVP, never by dismiss (the /read endpoint exempts them),
  // so the Dismiss control is offered for every other notification. It marks
  // the row read, dropping the card from the panel.
  async function dismiss() {
    setDismissing(true);
    try {
      await fetch(`/api/notifications/${notification.id}/read`, {
        method: "POST",
        credentials: "include",
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div
      className={`group bg-card border border-border shadow-brand-1 border-l-4 ${accent} rounded-md px-3 py-2.5 flex items-start gap-3`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {notification.title}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {notification.link && (
              <a
                href={notification.link}
                onClick={(e) => {
                  if (!notification.readAt && !isInvite) {
                    // keepalive: true so the POST survives the navigation the
                    // anchor's default action may start. Meeting invites clear
                    // only via RSVP — never via link.
                    fetch(`/api/notifications/${notification.id}/read`, {
                      method: "POST",
                      credentials: "include",
                      keepalive: true,
                    });
                  }
                  openTarget(e, notification.link!, notification.title, onOpen);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Open linked page"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {!isInvite && (
              <button
                type="button"
                onClick={dismiss}
                disabled={dismissing}
                className={buttonClasses("secondary", "sm", "gap-1")}
                aria-label="Dismiss notification"
              >
                <Check className="w-3 h-3" />
                {dismissing ? "Dismissing…" : "Dismiss"}
              </button>
            )}
          </div>
        </div>
        {notification.body && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notification.body}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground/70">
            {relativeTime(notification.createdAt)}
          </span>
          {rsvp && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                rsvp === "Accepted"
                  ? "bg-green-100 text-green-800"
                  : rsvp === "Declined"
                    ? "bg-red-100 text-red-800"
                    : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {rsvp}
            </span>
          )}
        </div>
        {isInvite && !rsvp && (
          <RsvpButtons notificationId={notification.id} onResponded={setRsvp} />
        )}
      </div>
    </div>
  );
}
