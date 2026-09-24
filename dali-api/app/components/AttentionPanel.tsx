import { useState, type MouseEvent, type ReactNode } from "react";
import { useRevalidator } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  X,
  type LucideIcon,
} from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating";
import { Modal } from "~/components/Modal";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { RsvpButtons, notifyTasksChanged } from "~/components/RsvpButtons";
import { buttonClasses } from "~/components/ui/Button";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { cn } from "~/lib/cn";
import { projectWorkMeta, type ProjectWorkItem } from "~/lib/project-work";
import { EVENT_TYPES, isEventType } from "~/lib/notification-events";
// The client mirror of ~/lib/tasks' `Task`, so the shell's panel pulls in no
// server code (see NotificationBell).
import type { OpenTask } from "~/components/NotificationBell";

/* ------------------------------------------------------------------ */
/* The attention stack: open tasks, notifications (incl. meeting-invite */
/* RSVP) still waiting on the user and, behind the my-project-work      */
/* flag, their assigned project tasks. Rendered by the shell's bell     */
/* drawer and the My Tasks page, split into Project work and Meetings & */
/* events tabs.                                                         */
/*                                                                      */
/* The drawer is poll-driven, not loader-driven: the shell feeds it     */
/* from the same /api/notifications poll that backs the bell's count    */
/* (see NotificationBell), so acting on a card converges through        */
/* notifyTasksChanged() rather than a route revalidation.               */
/* ------------------------------------------------------------------ */

// One feed row, as /api/notifications returns it. Mirrors the fields the
// cards render — kept local so this client module imports no server code.
export type AttentionNotification = {
  id: string;
  kind: "General" | "MeetingInvite" | "MeetingReminder" | "SystemAnnouncement" | "Education";
  eventType?: string;
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

/**
 * Count for the bell badge and the drawer header: every card the drawer shows,
 * less read invites kept only for their RSVP. Pings folded into their project
 * task's card don't count twice.
 */
export function attentionCount(
  tasks: OpenTask[],
  notifications: AttentionNotification[],
  projectTasks: ProjectWorkItem[] = [],
): number {
  const { work, admin } = splitFeed(tasks, notifications, projectTasks);
  return [...work, ...admin].filter(
    (c) => c.type !== "notification" || !c.notification.readAt,
  ).length;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */

export type FeedCard =
  | { type: "task"; task: OpenTask }
  | { type: "notification"; notification: AttentionNotification }
  // `pings`: unread Tasks-area notifications about this same task (due
  // reminder, assignment, comments), folded in rather than shown twice and
  // cleared when the card is acted on.
  | { type: "project"; item: ProjectWorkItem; pings: string[] };

export type FeedTab = "work" | "admin";

export const FEED_TAB_LABELS: Record<FeedTab, string> = {
  work: "Project work",
  admin: "Meetings & events",
};

// The registry's "Tasks" area is the project-work events: task.* and sprint
// wrap-ups. Everything else (meetings, forms, announcements, hiring…) is admin.
function isProjectWorkEvent(eventType: string | null | undefined): boolean {
  return isEventType(eventType) && EVENT_TYPES[eventType].area === "Tasks";
}

// Which project task a ping is about: task.* events link to the board with
// `?task=<id>`.
function pingTaskId(link: string | null): string | null {
  if (!link) return null;
  try {
    return new URL(link, "http://x").searchParams.get("task");
  } catch {
    return null;
  }
}

export function splitFeed(
  tasks: OpenTask[],
  notifications: AttentionNotification[],
  projectTasks: ProjectWorkItem[],
): Record<FeedTab, FeedCard[]> {
  const pingsByTask = new Map<string, string[]>(projectTasks.map((p) => [p.id, []]));
  const work: FeedCard[] = [];
  const admin: FeedCard[] = [];

  function place(
    card: FeedCard,
    id: string,
    eventType: string | null | undefined,
    link: string | null,
    unread: boolean,
  ) {
    if (!isProjectWorkEvent(eventType)) return admin.push(card);
    const folded = pingsByTask.get(pingTaskId(link) ?? "");
    if (folded && unread) return folded.push(id);
    work.push(card);
  }

  for (const task of tasks) {
    place({ type: "task", task }, task.id, task.eventType, task.link, true);
  }
  for (const notification of extraNotifications(tasks, notifications)) {
    place(
      { type: "notification", notification },
      notification.id,
      notification.eventType,
      notification.link,
      !notification.readAt,
    );
  }
  work.unshift(
    ...projectTasks.map((item): FeedCard => ({
      type: "project",
      item,
      pings: pingsByTask.get(item.id)!,
    })),
  );
  return { work, admin };
}

function cardKey(card: FeedCard): string {
  if (card.type === "task") return `t:${card.task.id}`;
  if (card.type === "notification") return `n:${card.notification.id}`;
  return `p:${card.item.id}`;
}

/* ------------------------------------------------------------------ */
/* The drawer (bell)                                                    */
/* ------------------------------------------------------------------ */

export function TasksDrawer({
  open,
  onClose,
  tasks,
  notifications,
  projectTasks,
  onOpen,
  seeAll,
}: {
  open: boolean;
  onClose: () => void;
  tasks: OpenTask[];
  notifications: AttentionNotification[];
  projectTasks: ProjectWorkItem[];
  onOpen?: OpenLink;
  seeAll?: ReactNode;
}) {
  const showWork = useFeatureFlag("my-project-work");
  const [tab, setTab] = useState<FeedTab>("work");
  const feed = splitFeed(tasks, notifications, projectTasks);
  const count = attentionCount(tasks, notifications, projectTasks);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="tasks-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-os-overlay"
      containerClassName="flex h-full w-full max-w-[480px] flex-col border-l border-os-container bg-os-card shadow-[-24px_0_60px_var(--color-os-shadow)] outline-none motion-safe:animate-detail-panel"
    >
      <div className="flex items-center gap-2 px-6 pt-6 pb-4">
        <h2 id="tasks-drawer-title" className="flex-1 text-lg font-bold text-foreground">
          Tasks ({count})
        </h2>
        {seeAll}
        <IconButton label="Close" icon={X} onClick={onClose} className="h-9 w-9" iconClassName="h-5 w-5" />
      </div>
      {showWork && (
        <div className="px-5 pb-3.5">
          <FeedTabs tab={tab} onChange={setTab} feed={feed} stretch />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6">
        <TaskFeed
          cards={showWork ? feed[tab] : [...feed.admin, ...feed.work]}
          tab={showWork ? tab : undefined}
          onOpen={onOpen}
        />
      </div>
    </Modal>
  );
}

export function FeedTabs({
  tab,
  onChange,
  feed,
  stretch,
}: {
  tab: FeedTab;
  onChange: (tab: FeedTab) => void;
  feed: Record<FeedTab, FeedCard[]>;
  stretch?: boolean;
}) {
  return (
    <SegmentedTabButtons
      label="Task type"
      stretch={stretch}
      items={(["work", "admin"] as const).map((key) => ({
        label: FEED_TAB_LABELS[key],
        count: feed[key].length,
        active: tab === key,
        onClick: () => onChange(key),
      }))}
    />
  );
}

/** The cards for one tab, or its empty state. `grid` lays them two-up (page). */
export function TaskFeed({
  cards,
  tab,
  onOpen,
  grid = false,
}: {
  cards: FeedCard[];
  tab?: FeedTab;
  onOpen?: OpenLink;
  grid?: boolean;
}) {
  if (cards.length === 0) {
    return (
      <div className="m-auto flex flex-col items-center gap-2.5 py-10 text-center text-os-grey">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        <strong className="text-base text-foreground">You&apos;re all caught up</strong>
        <span className="text-sm">
          {tab === "work"
            ? "New project tasks will show up here."
            : tab === "admin"
              ? "New invites and events will show up here."
              : "New tasks will show up here."}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        grid ? "grid grid-cols-1 gap-3.5 lg:grid-cols-2" : "flex flex-col gap-3",
      )}
    >
      {cards.map((card) => (
        <FeedCardView key={cardKey(card)} card={card} onOpen={onOpen} filled={grid} />
      ))}
    </div>
  );
}

function FeedCardView({
  card,
  onOpen,
  filled,
}: {
  card: FeedCard;
  onOpen?: OpenLink;
  filled: boolean;
}) {
  if (card.type === "task") return <TaskCard task={card.task} onOpen={onOpen} filled={filled} />;
  if (card.type === "notification") {
    return <NotificationCard notification={card.notification} onOpen={onOpen} filled={filled} />;
  }
  return (
    <ProjectTaskCard item={card.item} pings={card.pings} onOpen={onOpen} filled={filled} />
  );
}

/* ------------------------------------------------------------------ */
/* Card pieces                                                          */
/* ------------------------------------------------------------------ */

// One line of card text, cut with an ellipsis. The full text shows on hover,
// but only when it was actually cut (measured on enter, not on every render).
function Truncated({
  as = "span",
  text,
  className,
}: {
  as?: "span" | "p" | "h3";
  text: string;
  className?: string;
}) {
  const Tag = as as "span";
  const [cut, setCut] = useState(false);
  return (
    <Tooltip content={text} variant="rich" disabled={!cut}>
      <Tag
        className={cn("block min-w-0 truncate", className)}
        onMouseEnter={(e) => setCut(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)}
      >
        {text}
      </Tag>
    </Tooltip>
  );
}

// Every card is the same shape: up to three single-line rows of text in a
// fixed-height block (leading-5 / 6 / 5 plus two gaps = 76px), then the
// actions. So the buttons sit at the same place on every card, and `h-full` +
// `mt-auto` keeps them bottom-aligned across a grid row. Drawer cards are
// outlined on the drawer's card fill; page cards take the fill themselves.
export function CardShell({
  filled,
  project,
  title,
  body,
  meta,
  children,
}: {
  filled: boolean;
  project?: string;
  title: string;
  body?: string | null;
  meta: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article
      className={cn(
        "flex h-full min-w-0 flex-col rounded-2xl border border-os-container px-[18px] py-4",
        filled && "bg-os-card",
      )}
    >
      <div className="flex min-h-[76px] flex-col gap-1.5">
        {project && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold leading-5 text-os-muted">
            <i className="h-[7px] w-[7px] shrink-0 rounded-full bg-os-accent" aria-hidden />
            <Truncated text={project} />
          </span>
        )}
        <Truncated
          as="h3"
          text={title}
          className="text-[15.5px] font-bold leading-6 text-foreground"
        />
        {body && (
          <Truncated as="p" text={body} className="text-[13px] leading-5 text-os-grey" />
        )}
        {meta}
      </div>
      {children && <div className="mt-auto flex flex-wrap gap-2 pt-3.5">{children}</div>}
    </article>
  );
}

export function Meta({
  icon: Icon,
  lead,
  warn = false,
  text,
}: {
  icon?: LucideIcon;
  /** Drawn before the text in place of an icon (a status dot). */
  lead?: ReactNode;
  warn?: boolean;
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-[7px] text-[13px] leading-5",
        warn ? "text-os-amber" : "text-os-grey",
      )}
    >
      {Icon && <Icon className="h-[15px] w-[15px] shrink-0" aria-hidden />}
      {lead}
      <Truncated text={text} />
    </div>
  );
}

export const ctaClass = (primary: boolean) =>
  buttonClasses(primary ? "primary" : "secondary", "md", "min-h-10");
export const ctaIcon = "h-[15px] w-[15px]";

export function CtaLink({
  href,
  label,
  onOpen,
  icon: Icon,
  primary = false,
  children,
  onBeforeOpen,
}: {
  href: string;
  label: string;
  onOpen?: OpenLink;
  icon: LucideIcon;
  primary?: boolean;
  children: ReactNode;
  onBeforeOpen?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onBeforeOpen?.();
        openTarget(e, href, label, onOpen);
      }}
      className={ctaClass(primary)}
    >
      <Icon className={ctaIcon} aria-hidden />
      {children}
    </a>
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

function TaskCard({
  task: t,
  onOpen,
  filled,
}: {
  task: OpenTask;
  onOpen?: OpenLink;
  filled: boolean;
}) {
  const revalidator = useRevalidator();
  const { confirm: confirmDialog } = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const meta = t.dueAt ? (
    <Meta icon={CalendarClock} text={formatDeadline(t.dueAt)} />
  ) : (
    <Meta text={t.source === "meeting" ? "Awaiting your response" : "Action needed"} />
  );
  const shell = (children?: ReactNode) => (
    <CardShell filled={filled} title={t.title} meta={meta}>
      {children}
    </CardShell>
  );

  // Meeting invites clear only on RSVP, never on a click — Accept/Maybe/Decline
  // inline. The RSVP revalidates, dropping the answered invite.
  if (t.source === "meeting") {
    return shell(<RsvpButtons notificationId={t.id} size="md" className="gap-2" />);
  }

  // A form todo self-clears on submit, so the card links to the form. But a
  // recipient who won't (or can't) fill it would otherwise be stuck with it
  // forever — the /read endpoint refuses a plain read — so offer a confirmed
  // Dismiss that clears the reminder without submitting (intent=dismiss).
  async function dismissForm() {
    const ok = await confirmDialog({
      title: "Dismiss this reminder?",
      description:
        "You haven't submitted this form. Dismissing removes it from your tasks. You can still find it in History.",
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

  if (t.formTodo && t.link) {
    return shell(
      <>
        <CtaLink href={t.link} label={t.title} onOpen={onOpen} icon={ArrowRight} primary>
          Open form
        </CtaLink>
        <button type="button" onClick={dismissForm} disabled={dismissing} className={ctaClass(false)}>
          <X className={ctaIcon} aria-hidden />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      </>,
    );
  }

  // Other self-clearing tasks that merely link (onboarding, an apply-to-cycle
  // task): opening is the action, there's no Confirm.
  if (t.hasAction && t.link) {
    return shell(
      <CtaLink href={t.link} label={t.title} onOpen={onOpen} icon={ArrowRight} primary>
        Open
      </CtaLink>,
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

  return shell(
    <>
      <button type="button" onClick={confirm} disabled={confirming} className={ctaClass(true)}>
        <Check className={ctaIcon} aria-hidden />
        {confirming ? "Confirming…" : "Confirm"}
      </button>
      {t.link && (
        <CtaLink href={t.link} label={t.title} onOpen={onOpen} icon={ExternalLink}>
          Open
        </CtaLink>
      )}
    </>,
  );
}

/* ------------------------------------------------------------------ */
/* Notification card                                                    */
/* ------------------------------------------------------------------ */

function NotificationCard({
  notification,
  onOpen,
  filled,
}: {
  notification: AttentionNotification;
  onOpen?: OpenLink;
  filled: boolean;
}) {
  const revalidator = useRevalidator();
  const isInvite =
    notification.kind === "MeetingInvite" && !!notification.scheduledMeetingId;
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

  const meta = (
    <Meta
      icon={isInvite ? Calendar : Clock}
      text={rsvp ?? relativeTime(notification.createdAt)}
    />
  );

  return (
    <CardShell
      filled={filled}
      title={notification.title}
      body={notification.body}
      meta={meta}
    >
      {isInvite && !rsvp ? (
        <RsvpButtons
          notificationId={notification.id}
          onResponded={setRsvp}
          size="md"
          className="gap-2"
        />
      ) : (
        <>
          {notification.link && (
            <CtaLink
              href={notification.link}
              label={notification.title}
              onOpen={onOpen}
              icon={ExternalLink}
              primary
              // keepalive so the POST survives the navigation the anchor may
              // start. Meeting invites clear only via RSVP, never via link.
              onBeforeOpen={() => {
                if (notification.readAt || isInvite) return;
                fetch(`/api/notifications/${notification.id}/read`, {
                  method: "POST",
                  credentials: "include",
                  keepalive: true,
                });
              }}
            >
              Open
            </CtaLink>
          )}
          {!isInvite && (
            <button
              type="button"
              onClick={dismiss}
              disabled={dismissing}
              className={ctaClass(!notification.link)}
            >
              <Check className={ctaIcon} aria-hidden />
              {dismissing ? "Dismissing…" : "Dismiss"}
            </button>
          )}
        </>
      )}
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* Project task card (Project work tab)                                 */
/* ------------------------------------------------------------------ */

const WORK_META_ICON = {
  overdue: AlertTriangle,
  stale: AlertTriangle,
  review: Eye,
  due: Clock,
  none: Calendar,
} as const;

function ProjectTaskCard({
  item,
  pings,
  onOpen,
  filled,
}: {
  item: ProjectWorkItem;
  pings: string[];
  onOpen?: OpenLink;
  filled: boolean;
}) {
  const revalidator = useRevalidator();
  const toast = useToast();
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const meta = projectWorkMeta(item);

  // The folded pings were only pointing at this task, so acting on it clears
  // them. keepalive: Open task may navigate away mid-request.
  function clearPings() {
    return Promise.all(
      pings.map((id) =>
        fetch(`/api/notifications/${id}/read`, {
          method: "POST",
          credentials: "include",
          keepalive: true,
        }).catch(() => undefined),
      ),
    );
  }

  // Same endpoint as a drag into the Done column, so assignee notifications and
  // the GitHub mirror follow. Hidden at once; the poll converges the count.
  async function markDone() {
    setState("saving");
    try {
      const res = await fetch(`/api/tasks/${item.id}/move`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "Done", position: 0 }),
      });
      if (!res.ok) throw new Error();
      // Before the refresh: with the task gone, an uncleared ping would
      // surface as its own card.
      await clearPings();
      setState("done");
      toast.success("Marked done");
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setState("idle");
      toast.error("Couldn't mark this task done.");
    }
  }

  if (state === "done") return null;

  return (
    <CardShell
      filled={filled}
      project={item.projectName}
      title={item.title}
      meta={
        <Meta icon={WORK_META_ICON[meta.kind]} warn={meta.warn} text={meta.text} />
      }
    >
      <CtaLink
        href={item.link}
        label={item.title}
        onOpen={onOpen}
        icon={ArrowRight}
        primary
        onBeforeOpen={() => {
          if (pings.length) void clearPings().then(notifyTasksChanged);
        }}
      >
        Open task
      </CtaLink>
      <button
        type="button"
        onClick={markDone}
        disabled={state === "saving"}
        className={ctaClass(false)}
      >
        <Check className={ctaIcon} aria-hidden />
        {state === "saving" ? "Saving…" : "Mark done"}
      </button>
    </CardShell>
  );
}
