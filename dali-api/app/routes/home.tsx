import { useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import {
  Bell,
  Check,
  X as XIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import type { Route } from "./+types/home";

type HomeNotification = {
  id: string;
  kind: "General" | "MeetingInvite" | "MeetingReminder" | "SystemAnnouncement";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  scheduledMeetingId: string | null;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const items = await prisma.notification.findMany({
    where: { recipientUserId: auth.user.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
      scheduledMeetingId: true,
      rsvp: true,
    },
  });
  const notifications: HomeNotification[] = items.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    scheduledMeetingId: n.scheduledMeetingId,
    rsvp: n.rsvp,
  }));
  return { user: auth.user, notifications };
}

export default function Home() {
  const { user, notifications } = useLoaderData<typeof loader>();
  const firstName = user.firstName || user.email.split("@")[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here's what's happening in the lab this week.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <NotificationsPanel notifications={notifications} />
        <WeekCalendarPanel />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications panel                                                  */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationsPanel({ notifications }: { notifications: HomeNotification[] }) {
  const unread = notifications.filter((n) => !n.readAt).length;
  const revalidator = useRevalidator();
  const [markingAll, setMarkingAll] = useState(false);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        credentials: "include",
      });
      revalidator.revalidate();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <aside className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Bell className="w-4 h-4 text-accent-coral" />
          Notifications
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {unread > 0 ? `${unread} unread` : `${notifications.length} total`}
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={markingAll}
              className="text-xs font-medium text-accent-coral hover:underline disabled:opacity-50"
            >
              {markingAll ? "Marking…" : "Mark all read"}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground px-3 py-6 bg-card border border-border rounded-md text-center">
            No notifications yet.
          </p>
        ) : (
          notifications.map((n) => <NotificationCard key={n.id} notification={n} />)
        )}
      </div>
    </aside>
  );
}

function NotificationCard({ notification }: { notification: HomeNotification }) {
  const isUnread = !notification.readAt;
  const isInvite = notification.kind === "MeetingInvite" && !!notification.scheduledMeetingId;
  const accent = isUnread ? "border-l-accent-coral" : "border-l-accent-teal";
  const [rsvp, setRsvp] = useState<HomeNotification["rsvp"]>(notification.rsvp);
  const [submitting, setSubmitting] = useState<null | "accepted" | "declined" | "tentative">(null);
  const [error, setError] = useState<string | null>(null);

  async function sendRsvp(response: "accepted" | "declined" | "tentative") {
    setSubmitting(response);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${notification.id}/rsvp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to RSVP");
      } else {
        setRsvp(response === "accepted" ? "Accepted" : response === "declined" ? "Declined" : "Tentative");
        if (json.gcalError) setError(`Recorded in-app, but Google sync failed: ${json.gcalError}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      className={`group bg-card border border-border border-l-4 ${accent} rounded-md px-3 py-2.5 flex items-start gap-3`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{notification.title}</span>
          {notification.link && (
            <a
              href={notification.link}
              onClick={(e) => {
                if (!notification.readAt) {
                  // keepalive: true so the POST survives the navigation
                  // that the anchor's default action is about to start.
                  fetch(`/api/notifications/${notification.id}/read`, {
                    method: "POST",
                    credentials: "include",
                    keepalive: true,
                  });
                }
                // If we're inside a TabWorkspace iframe, ask the parent to
                // open the link as a new tab instead of letting it navigate
                // the iframe (which strands the user in chrome-less embed
                // mode with no way back).
                const link = notification.link!;
                if (link.startsWith("/") && window.self !== window.top) {
                  e.preventDefault();
                  window.parent.postMessage(
                    { type: "dali:openTab", url: link, label: notification.title },
                    window.location.origin,
                  );
                }
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open linked page"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        {notification.body && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
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
          <div className="flex items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => sendRsvp("accepted")}
              disabled={!!submitting}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {submitting === "accepted" ? "Accepting…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => sendRsvp("tentative")}
              disabled={!!submitting}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
            >
              <HelpCircle className="w-3 h-3" />
              {submitting === "tentative" ? "…" : "Maybe"}
            </button>
            <button
              type="button"
              onClick={() => sendRsvp("declined")}
              disabled={!!submitting}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
            >
              <XIcon className="w-3 h-3" />
              {submitting === "declined" ? "…" : "Decline"}
            </button>
          </div>
        )}
        {error && <p className="text-[10px] text-red-700 mt-1">{error}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* This-week calendar                                                  */
/* ------------------------------------------------------------------ */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_PX = 44;
const DAYS = [
  { key: "SUN", num: 10 },
  { key: "MON", num: 11 },
  { key: "TUE", num: 12 },
  { key: "WED", num: 13 },
  { key: "THU", num: 14 },
  { key: "FRI", num: 15 },
  { key: "SAT", num: 16 },
];

const EVENT_TEXT = "text-[hsl(203_38%_18%)]";

type WeekEvent = {
  startHour: number;
  duration: number;
  label: string;
  className: string;
};

const WEEK_EVENTS: Record<number, WeekEvent[]> = {
  1: [
    { startHour: 10, duration: 1, label: "Standup", className: `bg-accent-teal ${EVENT_TEXT}` },
    { startHour: 14, duration: 1.5, label: "Design crit", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
  2: [
    { startHour: 11, duration: 1, label: "Partner sync", className: `bg-accent-green ${EVENT_TEXT}` },
  ],
  3: [
    { startHour: 9, duration: 1, label: "Standup", className: `bg-accent-teal ${EVENT_TEXT}` },
    { startHour: 15, duration: 2, label: "DALI hours", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
  4: [
    { startHour: 13, duration: 1, label: "1:1 w/ PM", className: `bg-accent-green ${EVENT_TEXT}` },
  ],
  5: [
    { startHour: 16, duration: 1, label: "Lab meeting", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
};

function WeekCalendarPanel() {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          This Week
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous week"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next week"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex border border-border rounded-md overflow-hidden">
        <div className="flex flex-col w-12 border-r border-border bg-card text-[10px] text-muted-foreground">
          <div className="h-9 border-b border-border" />
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="px-1.5 pt-0.5 text-right">
              {formatHour(h)}
            </div>
          ))}
        </div>
        {DAYS.map((d, idx) => (
          <div key={d.key} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
            <div className="flex flex-col items-center justify-center border-b border-border h-9">
              <div className="text-[9px] font-semibold text-muted-foreground tracking-wide">
                {d.key}
              </div>
              <div className="text-xs font-bold text-foreground">{d.num}</div>
            </div>
            <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {(WEEK_EVENTS[idx] ?? []).map((e, i) => (
                <div
                  key={i}
                  className={`absolute left-0 right-0 mx-0.5 px-1 py-0.5 rounded-sm text-[10px] font-medium overflow-hidden ${e.className}`}
                  style={{
                    top: (e.startHour - HOURS[0]) * HOUR_PX,
                    height: e.duration * HOUR_PX,
                  }}
                >
                  <span className="truncate block">{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}
