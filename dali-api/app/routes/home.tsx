import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import {
  ListTodo,
  Check,
  X as XIcon,
  CalendarDays,
  ExternalLink,
  HelpCircle,
  CalendarClock,
  GraduationCap,
  Users2,
  ArrowRight,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { listOpenTasks, type Task } from "~/lib/tasks";
import { fetchBusyEvents } from "~/lib/google-calendar";
import { currentTerm, hasCycleAccess } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
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

type AgendaEvent = {
  id: string;
  title: string;
  startIso: string;
  durationMinutes: number;
  isOrganizer: boolean;
};

type BusyBlock = { startIso: string; endIso: string };

type HiringFocus = {
  cycleId: string;
  cycleName: string;
  currentStatus: "Open" | "UnderReview";
  isInterviewer: boolean;
  activeAssignments: number;
  upcomingThisWeek: number;
};

type StaffingFocus = {
  name: string;
};

// Local-time Sunday 00:00 of the week containing `d`. The week grid renders
// Sun → Sat, matching how the lab already talks about the schedule.
function startOfWeekLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const now = new Date();
  const weekStart = startOfWeekLocal(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [items, tasks, meetings, busyEvents, activeCycle, term] =
    await Promise.all([
      prisma.notification.findMany({
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
      }),
      listOpenTasks(auth.user.sub),
      prisma.scheduledMeeting.findMany({
        where: {
          status: "Confirmed",
          selectedAt: { gte: weekStart, lt: weekEnd },
          OR: [
            { organizerId: auth.user.sub },
            { participantUserIds: { has: auth.user.sub } },
          ],
        },
        select: {
          id: true,
          title: true,
          selectedAt: true,
          durationMinutes: true,
          organizerId: true,
        },
        orderBy: { selectedAt: "asc" },
      }),
      // Google busy can fail (token expiry, network) — degrade silently so a
      // bad calendar link never breaks the home tab.
      fetchBusyEvents(auth.user.sub, weekStart, weekEnd).catch(() => []),
      getActiveCycle("Standard"),
      currentTerm(),
    ]);

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

  const weekEvents: AgendaEvent[] = meetings
    .filter((m) => m.selectedAt !== null)
    .map((m) => ({
      id: m.id,
      title: m.title,
      startIso: m.selectedAt!.toISOString(),
      durationMinutes: m.durationMinutes,
      isOrganizer: m.organizerId === auth.user.sub,
    }));

  const busy: BusyBlock[] = busyEvents.map((b) => ({
    startIso: b.start,
    endIso: b.end,
  }));

  let hiring: HiringFocus | null = null;
  if (activeCycle) {
    const access = await hasCycleAccess(auth.user.sub, activeCycle.id);
    if (access) {
      const interviewerRows = await prisma.cycleInterviewer.findMany({
        where: {
          userId: auth.user.sub,
          applicationCycleId: activeCycle.id,
        },
        select: { id: true },
      });
      let activeAssignments = 0;
      let upcomingThisWeek = 0;
      if (interviewerRows.length > 0) {
        const assignments = await prisma.interviewAssignment.findMany({
          where: {
            cycleInterviewerId: { in: interviewerRows.map((r) => r.id) },
            status: "Active",
            interview: { status: "Scheduled" },
          },
          select: { interview: { select: { startTime: true } } },
        });
        activeAssignments = assignments.length;
        upcomingThisWeek = assignments.filter((a) => {
          const t = a.interview.startTime;
          return t >= weekStart && t < weekEnd;
        }).length;
      }
      hiring = {
        cycleId: activeCycle.id,
        cycleName: activeCycle.name,
        currentStatus: activeCycle.currentStatus,
        isInterviewer: interviewerRows.length > 0,
        activeAssignments,
        upcomingThisWeek,
      };
    }
  }

  let staffing: StaffingFocus | null = null;
  if (term) {
    const cycle = await prisma.staffingCycle.findUnique({
      where: { termId: term.id },
      select: { name: true },
    });
    if (cycle) staffing = { name: cycle.name };
  }

  return {
    user: auth.user,
    notifications,
    tasks,
    weekEvents,
    busy,
    weekStartIso: weekStart.toISOString(),
    hiring,
    staffing,
  };
}

export default function Home() {
  const {
    user,
    notifications,
    tasks,
    weekEvents,
    busy,
    weekStartIso,
    hiring,
    staffing,
  } = useLoaderData<typeof loader>();
  const firstName = user.firstName || user.email.split("@")[0];
  const railHasContent = hiring !== null || staffing !== null;

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

      {(tasks.length > 0 || notifications.length > 0) && (
        <AttentionBanner tasks={tasks} notifications={notifications} />
      )}

      <div
        className={
          railHasContent
            ? "flex flex-col gap-6 lg:flex-row lg:items-start"
            : "flex flex-col gap-6"
        }
      >
        <div className={railHasContent ? "flex-1 min-w-0" : ""}>
          <WeekAgendaPanel
            events={weekEvents}
            busy={busy}
            weekStartIso={weekStartIso}
          />
        </div>
        {railHasContent && (
          <aside className="flex flex-col gap-4 lg:w-72 lg:shrink-0">
            {hiring && <HiringFocusCard data={hiring} />}
            {staffing && <StaffingCard data={staffing} />}
          </aside>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attention banner — the single home surface for things needing the    */
/* user: open tasks plus notifications (incl. meeting-invite RSVP).      */
/* Only rendered when there's at least one of either.                    */
/* ------------------------------------------------------------------ */

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AttentionBanner({
  tasks,
  notifications,
}: {
  tasks: Task[];
  notifications: HomeNotification[];
}) {
  // Tasks are themselves notification rows (Task.id === Notification.id), so a
  // task (e.g. an announcement-todo) also appears in the raw notifications
  // list. Drop those duplicates — the task card is the richer rendering
  // (deadline + form link) — so each item shows once.
  const taskIds = new Set(tasks.map((t) => t.id));
  const extraNotifications = notifications.filter((n) => !taskIds.has(n.id));

  // "Needs attention" = open tasks + unread non-task notifications. Read
  // notifications still render below (so RSVP stays reachable) but don't
  // inflate the count.
  const unread = extraNotifications.filter((n) => !n.readAt).length;
  const count = tasks.length + unread;

  return (
    <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ListTodo className="w-4 h-4 text-accent-coral" />
        <span className="font-heading font-semibold text-sm text-foreground">
          {count > 0
            ? `${count} ${count === 1 ? "item needs" : "items need"} your attention`
            : "Your notifications"}
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tasks.map((t) => {
            const inner = (
              <>
                <span className="block text-sm font-semibold text-foreground truncate">
                  {t.title}
                </span>
                {t.dueAt ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-coral mt-1">
                    <CalendarClock className="w-3 h-3" />
                    {formatDeadline(t.dueAt)}
                  </span>
                ) : (
                  <span className="block text-[11px] text-muted-foreground mt-1">
                    {t.source === "meeting"
                      ? "Awaiting your response"
                      : "Action needed"}
                  </span>
                )}
              </>
            );
            const cls =
              "flex-shrink-0 w-56 bg-card border border-border rounded-md px-3 py-2";
            return t.link ? (
              <a
                key={t.id}
                href={t.link}
                onClick={(e) => {
                  // Tasks are themselves notification rows, so POST /read
                  // clears the tile + the count once the user acts on it.
                  // keepalive lets the request survive the navigation.
                  fetch(`/api/notifications/${t.id}/read`, {
                    method: "POST",
                    credentials: "include",
                    keepalive: true,
                  });
                  // Inside a TabWorkspace iframe: hand the URL to the parent
                  // shell so the user lands in a real tab instead of being
                  // stranded in the chrome-less embed.
                  const link = t.link!;
                  if (link.startsWith("/") && window.self !== window.top) {
                    e.preventDefault();
                    window.parent.postMessage(
                      { type: "dali:openTab", url: link, label: t.title },
                      window.location.origin,
                    );
                  }
                }}
                className={`${cls} hover:border-accent-coral/50 transition-colors`}
              >
                {inner}
              </a>
            ) : (
              <div key={t.id} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {extraNotifications.length > 0 && (
        <div
          className={`flex flex-col gap-2 ${tasks.length > 0 ? "mt-3 pt-3 border-t border-accent-coral/20" : ""}`}
        >
          {extraNotifications.map((n) => (
            <NotificationCard key={n.id} notification={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notification card (rendered inside the attention banner)             */
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
/* This-week agenda — real meetings + Google busy on a Sun–Sat grid     */
/* ------------------------------------------------------------------ */

// Visible window is 8am–8pm. Anything earlier/later is clipped to the
// grid edges so a 7am standup or 9pm partner call still shows as a
// bar at the top/bottom rather than disappearing.
const HOUR_START = 8;
const HOUR_END = 20;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START + 1 },
  (_, i) => HOUR_START + i,
);
const VISIBLE_HOURS = HOUR_END - HOUR_START;
const HOUR_PX = 44;
const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

// Convert a Date to its local hour-of-day as a float (e.g. 14.5 for 2:30pm).
function localHourFloat(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

// Returns null when the event lies entirely outside the visible window
// (so it's dropped rather than rendered as a zero-height sliver).
function clipToWindow(
  startHour: number,
  endHour: number,
): { top: number; height: number } | null {
  const s = Math.max(startHour, HOUR_START);
  const e = Math.min(endHour, HOUR_END);
  if (e <= s) return null;
  return {
    top: (s - HOUR_START) * HOUR_PX,
    height: (e - s) * HOUR_PX,
  };
}

function WeekAgendaPanel({
  events,
  busy,
  weekStartIso,
}: {
  events: AgendaEvent[];
  busy: BusyBlock[];
  weekStartIso: string;
}) {
  const weekStart = new Date(weekStartIso);
  const days = DAY_KEYS.map((key, idx) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + idx);
    return { key, date, num: date.getDate() };
  });
  const todayIdx = (() => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const diffDays = Math.floor(
      (startOfToday.getTime() - weekStart.getTime()) / 86_400_000,
    );
    return diffDays >= 0 && diffDays < 7 ? diffDays : -1;
  })();

  const eventsByDay: AgendaEvent[][] = days.map(() => []);
  for (const ev of events) {
    const start = new Date(ev.startIso);
    const idx = Math.floor(
      (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
        weekStart.getTime()) /
        86_400_000,
    );
    if (idx >= 0 && idx < 7) eventsByDay[idx].push(ev);
  }

  const busyByDay: BusyBlock[][] = days.map(() => []);
  for (const b of busy) {
    const start = new Date(b.startIso);
    const idx = Math.floor(
      (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
        weekStart.getTime()) /
        86_400_000,
    );
    if (idx >= 0 && idx < 7) busyByDay[idx].push(b);
  }

  const rangeLabel = (() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(weekStart)} – ${fmt(end)}`;
  })();

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          This Week
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {rangeLabel}
          </span>
        </h2>
        <a
          href="/calendar"
          onClick={(e) => {
            if (window.self !== window.top) {
              e.preventDefault();
              window.parent.postMessage(
                { type: "dali:openTab", url: "/calendar", label: "Calendar" },
                window.location.origin,
              );
            }
          }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Open calendar
          <ArrowRight className="w-3 h-3" />
        </a>
      </div>
      <div className="flex border border-border rounded-md overflow-hidden">
        <div className="flex flex-col w-12 border-r border-border bg-card text-[10px] text-muted-foreground">
          <div className="h-9 border-b border-border" />
          {HOURS.slice(0, -1).map((h) => (
            <div
              key={h}
              style={{ height: HOUR_PX }}
              className="px-1.5 pt-0.5 text-right"
            >
              {formatHour(h)}
            </div>
          ))}
        </div>
        {days.map((d, idx) => (
          <div
            key={d.key}
            className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col"
          >
            <div
              className={`flex flex-col items-center justify-center border-b border-border h-9 ${idx === todayIdx ? "bg-accent-coral/10" : ""}`}
            >
              <div className="text-[9px] font-semibold text-muted-foreground tracking-wide">
                {d.key}
              </div>
              <div
                className={`text-xs font-bold ${idx === todayIdx ? "text-accent-coral" : "text-foreground"}`}
              >
                {d.num}
              </div>
            </div>
            <div className="relative" style={{ height: VISIBLE_HOURS * HOUR_PX }}>
              {HOURS.slice(0, -1).map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {busyByDay[idx].map((b, i) => {
                const start = new Date(b.startIso);
                const end = new Date(b.endIso);
                const pos = clipToWindow(
                  localHourFloat(start),
                  localHourFloat(end),
                );
                if (!pos) return null;
                return (
                  <div
                    key={`busy-${i}`}
                    title="Busy (from your Google Calendar)"
                    className="absolute left-0 right-0 bg-muted/60"
                    style={{ top: pos.top, height: pos.height }}
                  />
                );
              })}
              {eventsByDay[idx].map((ev) => {
                const start = new Date(ev.startIso);
                const startHour = localHourFloat(start);
                const endHour = startHour + ev.durationMinutes / 60;
                const pos = clipToWindow(startHour, endHour);
                if (!pos) return null;
                const timeLabel = start.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                });
                return (
                  <div
                    key={ev.id}
                    title={`${ev.title} — ${timeLabel}`}
                    className={`absolute left-0 right-0 mx-0.5 px-1 py-0.5 rounded-sm text-[10px] font-medium overflow-hidden text-[hsl(203_38%_18%)] ${ev.isOrganizer ? "bg-accent-coral-light" : "bg-accent-teal"}`}
                    style={{ top: pos.top, height: pos.height }}
                  >
                    <span className="truncate block">{ev.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {events.length === 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          No scheduled meetings this week.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Conditional right-rail cards — each renders only when there is real  */
/* content; the rail itself collapses when none are present.            */
/* ------------------------------------------------------------------ */

function RailLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (href.startsWith("/") && window.self !== window.top) {
          e.preventDefault();
          window.parent.postMessage(
            { type: "dali:openTab", url: href, label },
            window.location.origin,
          );
        }
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent-coral hover:underline"
    >
      {label}
      <ArrowRight className="w-3 h-3" />
    </a>
  );
}

function HiringFocusCard({ data }: { data: HiringFocus }) {
  const phaseLabel =
    data.currentStatus === "Open" ? "Applications open" : "In review";
  const destination = data.isInterviewer
    ? `/hiring/reviewer`
    : `/hiring/applications`;
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-accent-coral" />
          <h2 className="font-heading font-semibold text-sm text-foreground">
            Hiring
          </h2>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-coral/10 text-accent-coral">
          {phaseLabel}
        </span>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">{data.cycleName}</p>
      {data.isInterviewer ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {data.upcomingThisWeek}
            </span>
            <span className="text-xs text-muted-foreground">
              {data.upcomingThisWeek === 1 ? "interview" : "interviews"} this
              week
            </span>
          </div>
          {data.activeAssignments > data.upcomingThisWeek && (
            <p className="text-[11px] text-muted-foreground">
              {data.activeAssignments} active assignment
              {data.activeAssignments === 1 ? "" : "s"} total
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          You have hiring-lead access for this cycle.
        </p>
      )}
      <RailLink href={destination} label="Open" />
    </section>
  );
}

function StaffingCard({ data }: { data: StaffingFocus }) {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="inline-flex items-center gap-2">
        <Users2 className="w-4 h-4 text-accent-teal" />
        <h2 className="font-heading font-semibold text-sm text-foreground">
          Staffing
        </h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">{data.name}</p>
      <p className="text-xs text-foreground">
        Submit your project preferences for the next term.
      </p>
      <RailLink href="/projects/intent-to-work" label="Open intent to work" />
    </section>
  );
}
