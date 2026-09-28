import { useEffect, useMemo, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import { ExternalLink, RotateCcw } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { buttonClasses } from "~/components/ui/Button";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import {
  listOpenTasks,
  listMyProjectTasks,
  listNotificationHistory,
  type Task,
  type NotificationHistoryItem,
  type NotificationHistoryResult,
  type NotificationState,
} from "~/lib/tasks";
import { listMyNotifications } from "~/lib/notifications";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import type { ProjectWorkItem } from "~/lib/project-work";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { formatInTimeZone, getZonedYMD, zonedDayLabel } from "~/lib/timezone";
import { RsvpButtons } from "~/components/RsvpButtons";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { useOsChrome } from "~/components/os-chrome";
import {
  CardShell,
  CtaLink,
  FEED_TAB_LABELS,
  Meta,
  TaskFeed,
  ctaClass,
  ctaIcon,
  attentionCount,
  splitFeed,
  type AttentionNotification,
  type FeedTab,
} from "~/components/AttentionPanel";
import type { Route } from "./+types/notifications";

export const meta: Route.MetaFunction = () => [
  { title: "My Tasks · DALI OS" },
];

export const handle = {
  breadcrumb: () => "My Tasks",
};

// Tab is driven by ?tab=work|open|history. `open` is the notification feed
// (Meetings & events once project work is on); `work` needs the
// my-project-work flag and falls back to `open` without it. The History tab
// fetches incrementally from /api/notifications with the additive history
// params. The open tabs render the same cards as the bell's drawer.
type PageTab = "work" | "open" | "history";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const userId = auth.user.sub;
  const url = new URL(request.url);
  const roles = await getUserRoles(userId);
  const showWork = await isFeatureEnabled("my-project-work", userId, roles, request);

  const [tasks, { items }, projectTasks] = await Promise.all([
    listOpenTasks(userId),
    listMyNotifications(userId),
    showWork ? listMyProjectTasks(userId) : ([] as ProjectWorkItem[]),
  ]);
  const notifications: AttentionNotification[] = items.map((n) => ({
    id: n.id,
    kind: n.kind,
    eventType: n.eventType,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    scheduledMeetingId: n.scheduledMeetingId,
    rsvp: n.rsvp,
  }));

  let history: NotificationHistoryResult | null = null;
  if (url.searchParams.get("tab") === "history") {
    const status = url.searchParams.get("status");
    history = await listNotificationHistory(userId, {
      status: status === "open" || status === "cleared" ? status : "all",
    });
  }

  return { tasks, notifications, projectTasks, history };
}

// History state as the status line's leading dot (quiet, like other status
// pills), not a tinted chip.
const STATE_DOT: Record<NotificationState, string> = {
  Open: "bg-os-accent",
  Submitted: "bg-os-green",
  Cleared: "bg-os-grey",
  Cancelled: "bg-red-500",
  Expired: "bg-os-muted",
};

// Group history rows into Today / Yesterday / <date> buckets, preserving the
// newest-first order the server returns. The day boundary is computed in the
// viewer's timezone so an 11pm-ET item doesn't read "Yesterday" to a PT user.
function dayLabel(iso: string, tz: string): string {
  const now = new Date();
  const sameYear = getZonedYMD(new Date(iso), tz).year === getZonedYMD(now, tz).year;
  return zonedDayLabel(iso, now, tz, {
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function timeLabel(iso: string, tz: string): string {
  return formatInTimeZone(iso, tz, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HistoryTab({
  initial,
  initialStatus,
}: {
  initial: NotificationHistoryResult;
  initialStatus: "open" | "cleared" | "all";
}) {
  const [status, setStatus] = useState<"open" | "cleared" | "all">(
    initialStatus,
  );
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [items, setItems] = useState<NotificationHistoryItem[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [counts, setCounts] = useState(initial.counts);
  const [loading, setLoading] = useState(false);
  const tz = useUserTimeZone();

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  // (Re)load the first page whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ status });
    if (debouncedQ) params.set("q", debouncedQ);
    fetch(`/api/notifications?${params.toString()}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NotificationHistoryResult | null) => {
        if (cancelled || !data) return;
        setItems(data.items);
        setCursor(data.nextCursor);
        setCounts(data.counts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, debouncedQ]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const params = new URLSearchParams({
      status,
      cursor: JSON.stringify(cursor),
    });
    if (debouncedQ) params.set("q", debouncedQ);
    try {
      const r = await fetch(`/api/notifications?${params.toString()}`, {
        credentials: "include",
      });
      if (!r.ok) return;
      const data = (await r.json()) as NotificationHistoryResult;
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  async function markUnread(id: string) {
    const r = await fetch(`/api/notifications/${id}/read`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "unread" }),
    });
    if (!r.ok) return;
    // Self-clearing rows (meeting invites, form todos, onboarding) own their
    // read state — the endpoint reports `skipped` instead of re-opening them,
    // so don't paint a flip the server didn't make.
    const body = (await r.json().catch(() => null)) as { skipped?: string } | null;
    if (body?.skipped) return;
    // Reflect the flip locally: move the row's state to Open and bump counts.
    setItems((prev) =>
      prev
        .map((n) =>
          n.id === id ? { ...n, state: "Open" as const, clearedAt: null } : n,
        )
        // If we're viewing only cleared rows, a re-opened row no longer belongs.
        .filter((n) => (status === "cleared" ? n.id !== id : true)),
    );
    setCounts((c) => ({ open: c.open + 1, cleared: Math.max(0, c.cleared - 1) }));
  }

  // Group rows by calendar day, keeping server order.
  const groups = useMemo(() => {
    const out: { label: string; rows: NotificationHistoryItem[] }[] = [];
    for (const item of items) {
      const label = dayLabel(item.sentAt, tz);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(item);
      else out.push({ label, rows: [item] });
    }
    return out;
  }, [items, tz]);

  const tabs: { key: "all" | "open" | "cleared"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: `Open (${counts.open})` },
    { key: "cleared", label: `Cleared (${counts.cleared})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedTabButtons
          label="Status"
          items={tabs.map((t) => ({
            label: t.label,
            active: status === t.key,
            onClick: () => setStatus(t.key),
          }))}
        />
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notifications…"
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {loading ? "Loading…" : "No notifications match these filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </h2>
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
                {g.rows.map((n) => (
                  <CardShell
                    key={n.id}
                    filled
                    title={n.title}
                    body={n.body}
                    meta={
                      <Meta
                        lead={
                          <i
                            className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[n.state]}`}
                            aria-hidden
                          />
                        }
                        text={[
                          n.state,
                          n.sender,
                          `sent ${timeLabel(n.sentAt, tz)}`,
                          n.clearedAt && `cleared ${timeLabel(n.clearedAt, tz)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                    }
                  >
                    {n.canRsvp ? (
                      <RsvpButtons notificationId={n.id} size="md" className="gap-2" />
                    ) : n.link || n.clearedAt ? (
                      <>
                        {/* Invites carry RSVP instead: their link only dumps
                            you on the calendar. */}
                        {n.link && (
                          <CtaLink
                            href={n.link}
                            label={n.title}
                            icon={ExternalLink}
                            primary
                          >
                            {n.state === "Submitted" ? "View" : "Open"}
                          </CtaLink>
                        )}
                        {n.clearedAt && (
                          <button
                            type="button"
                            onClick={() => void markUnread(n.id)}
                            className={ctaClass(false)}
                          >
                            <RotateCcw className={ctaIcon} aria-hidden />
                            Mark unread
                          </button>
                        )}
                      </>
                    ) : null}
                  </CardShell>
                ))}
              </div>
            </div>
          ))}
          {cursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className={buttonClasses("secondary", "md", "self-center")}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotificationsRoute() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const showWork = useFeatureFlag("my-project-work");
  const { pageTitle } = useOsChrome();

  const raw = searchParams.get("tab");
  const tab: PageTab =
    raw === "history"
      ? "history"
      : raw === "open" || !showWork
        ? "open"
        : "work";

  function switchTab(next: PageTab) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    params.delete("status");
    setSearchParams(params);
  }

  const tasks: Task[] = data.tasks;
  const feed = splitFeed(tasks, data.notifications, data.projectTasks);
  const count = attentionCount(tasks, data.notifications, data.projectTasks);
  const feedTab: FeedTab = tab === "work" ? "work" : "admin";

  const initialStatus =
    (searchParams.get("status") as "open" | "cleared" | "all") || "all";

  const tabs: { key: PageTab; label: string; count?: number }[] = showWork
    ? [
        { key: "work", label: FEED_TAB_LABELS.work, count: feed.work.length },
        { key: "open", label: FEED_TAB_LABELS.admin, count: feed.admin.length },
        { key: "history", label: "History" },
      ]
    : [
        { key: "open", label: "Open", count: feed.admin.length + feed.work.length },
        { key: "history", label: "History" },
      ];

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className={pageTitle}>My Tasks ({count})</h1>
        <SegmentedTabButtons
          label="Task type"
          items={tabs.map((t) => ({
            label: t.label,
            count: t.count,
            active: tab === t.key,
            onClick: () => switchTab(t.key),
          }))}
        />
      </div>

      {tab === "history" && data.history ? (
        <HistoryTab initial={data.history} initialStatus={initialStatus} />
      ) : (
        <TaskFeed
          grid
          cards={showWork ? feed[feedTab] : [...feed.admin, ...feed.work]}
          tab={showWork ? feedTab : undefined}
        />
      )}
    </div>
  );
}
