import { useEffect, useMemo, useState } from "react";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import {
  ListTodo,
  History as HistoryIcon,
  Search,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import {
  listOpenTasks,
  listNotificationHistory,
  type Task,
  type NotificationHistoryItem,
  type NotificationHistoryResult,
  type NotificationState,
} from "~/lib/tasks";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import type { Route } from "./+types/notifications";

export const meta: Route.MetaFunction = () => [
  { title: "My Tasks · DALI OS" },
];

export const handle = {
  breadcrumb: () => "My Tasks",
};

// Tab is driven by ?tab=open|history (default open). The History tab fetches
// incrementally from /api/notifications with the additive history params.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "history" ? "history" : "open";

  if (tab === "history") {
    const status =
      (url.searchParams.get("status") as "open" | "cleared" | "all") ?? "all";
    const history = await listNotificationHistory(auth.user.sub, {
      status:
        status === "open" || status === "cleared" || status === "all"
          ? status
          : "all",
    });
    return { tab, tasks: [] as Task[], history };
  }

  const tasks = await listOpenTasks(auth.user.sub);
  return { tab, tasks, history: null as NotificationHistoryResult | null };
}

const STATE_STYLES: Record<NotificationState, string> = {
  Open: "bg-accent-coral/15 text-accent-coral",
  Submitted: "bg-emerald-500/15 text-emerald-600",
  Cleared: "bg-muted text-muted-foreground",
  Cancelled: "bg-amber-500/15 text-amber-600",
  Expired: "bg-zinc-500/15 text-zinc-500",
};

function StateBadge({ state }: { state: NotificationState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLES[state]}`}
    >
      {state}
    </span>
  );
}

// Group history rows into Today / Yesterday / <date> buckets, preserving the
// newest-first order the server returns.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: now.getFullYear() === d.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function openLink(link: string, label: string) {
  if (!requestOpenTabIfEmbedded(link, label)) {
    window.location.assign(link);
  }
}

function OpenTab({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        You're all caught up — no open tasks.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => (
        <li
          key={t.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
        >
          <ListTodo className="w-4 h-4 mt-0.5 text-accent-coral flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {t.title}
            </p>
            {t.body && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {t.body}
              </p>
            )}
          </div>
          {t.link && (
            <button
              type="button"
              onClick={() => openLink(t.link!, t.title)}
              className="flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline flex-shrink-0"
            >
              Open <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
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
      const label = dayLabel(item.sentAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(item);
      else out.push({ label, rows: [item] });
    }
    return out;
  }, [items]);

  const tabs: { key: "all" | "open" | "cleared"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: `Open (${counts.open})` },
    { key: "cleared", label: `Cleared (${counts.cleared})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                status === t.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notifications…"
            className="w-full rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </div>
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
              <ul className="flex flex-col gap-2">
                {g.rows.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">
                          {n.title}
                        </p>
                        <StateBadge state={n.state} />
                      </div>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {n.sender ? `${n.sender} · ` : ""}
                        sent {timeLabel(n.sentAt)}
                        {n.clearedAt ? ` · cleared ${timeLabel(n.clearedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {n.link && (
                        <button
                          type="button"
                          onClick={() => openLink(n.link!, n.title)}
                          className="flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
                        >
                          {n.state === "Submitted" ? "View" : "Open"}{" "}
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                      {n.clearedAt && (
                        <button
                          type="button"
                          onClick={() => void markUnread(n.id)}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="w-3 h-3" /> Mark unread
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {cursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className="self-center rounded-lg border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
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
  const tab = searchParams.get("tab") === "history" ? "history" : "open";

  function switchTab(next: "open" | "history") {
    const params = new URLSearchParams(searchParams);
    if (next === "open") params.delete("tab");
    else params.set("tab", "history");
    setSearchParams(params);
  }

  const initialStatus =
    (searchParams.get("status") as "open" | "cleared" | "all") || "all";

  return (
    <div className="w-full max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          My Tasks
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your open tasks and the full history of everything you've been sent.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => switchTab("open")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "open"
              ? "border-accent-coral text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ListTodo className="w-4 h-4" /> Open
        </button>
        <button
          type="button"
          onClick={() => switchTab("history")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "history"
              ? "border-accent-coral text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <HistoryIcon className="w-4 h-4" /> History
        </button>
      </div>

      {tab === "history" && data.history ? (
        <HistoryTab initial={data.history} initialStatus={initialStatus} />
      ) : (
        <OpenTab tasks={data.tasks} />
      )}
    </div>
  );
}
