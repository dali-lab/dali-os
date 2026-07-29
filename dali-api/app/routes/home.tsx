import { useState, type MouseEvent } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import {
  ListTodo,
  ListChecks,
  Check,
  CalendarDays,
  ExternalLink,
  FileText,
  CalendarClock,
  GraduationCap,
} from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { listOpenTasks, type Task } from "~/lib/tasks";
import { ProjectIcon } from "~/components/ProjectIcon";
import { listedFormsFor, type ListedForm } from "~/forms/lib/public-form";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { listUpcomingSessionsForUser } from "~/education/lib/schedule.server";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { getZonedYMD, resolveUserTimeZone, zonedDayStartUtc } from "~/lib/timezone";
import { RsvpButtons, notifyTasksChanged } from "~/components/RsvpButtons";
import type { Route } from "./+types/home";

type HomeNotification = {
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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  // Current week (Sunday→following Sunday) in the viewer's timezone, used both to
  // build the day columns and to window the calendar fetch.
  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { timeZone: true },
  });
  const tz = resolveUserTimeZone(me);
  const now = new Date();
  const ymd = getZonedYMD(now, tz);
  const todayMidnightUtc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  const dow = todayMidnightUtc.getUTCDay();
  const sundayUtc = new Date(todayMidnightUtc.getTime() - dow * 86_400_000);
  const weekStart = zonedDayStartUtc(
    sundayUtc.getUTCFullYear(),
    sundayUtc.getUTCMonth() + 1,
    sundayUtc.getUTCDate(),
    tz,
  );
  const nextSundayUtc = new Date(sundayUtc.getTime() + 7 * 86_400_000);
  const weekEnd = zonedDayStartUtc(
    nextSundayUtc.getUTCFullYear(),
    nextSundayUtc.getUTCMonth() + 1,
    nextSundayUtc.getUTCDate(),
    tz,
  );

  const [items, tasks, rawEvents, formsForYou, assignedTasks, catalog, upcomingSessions] =
    await Promise.all([
    prisma.notification.findMany({
      // Hide invites whose meeting was Cancelled — they shouldn't appear in the
      // banner, just as they're dropped from tasks and the bell. Also hide
      // already-answered invites (Accepted/Declined/Tentative): once the user has
      // RSVP'd, the card has served its purpose and shouldn't linger.
      where: {
        recipientUserId: auth.user.sub,
        AND: [
          {
            OR: [
              { scheduledMeetingId: null },
              { scheduledMeeting: { status: { not: "Cancelled" } } },
            ],
          },
          {
            OR: [{ scheduledMeetingId: null }, { rsvp: null }],
          },
        ],
      },
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
    // Real events from the public DALI General Calendar (empty when unconfigured
    // or on fetch failure — the panel then shows an empty grid + hint).
    fetchGeneralCalendarEvents(weekStart, weekEnd),
    listedFormsFor(auth.user.sub),
    // Open board tasks assigned to the viewer, across all their projects
    // (Archived projects are retired — their tasks are noise here). One
    // bounded query: soonest deadline first (undated last), then priority.
    prisma.task.findMany({
      where: {
        status: { in: ["Todo", "InProgress", "InReview"] },
        assignees: { some: { userId: auth.user.sub } },
        project: { status: { not: "Archived" } },
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        projectId: true,
        project: { select: { name: true, iconEmoji: true } },
      },
    }),
    // Education for the home card: catalog (enrolled + open-registration +
    // open-assignment counts) and the viewer's next few sessions.
    listCatalog(auth.user.sub),
    listUpcomingSessionsForUser(auth.user.sub, { limit: 3 }),
  ]);

  const enrolledOfferings = catalog.filter((o) => o.myStatus === "Approved");
  const education: EducationSummary = {
    enrolledCount: enrolledOfferings.length,
    openAssignments: enrolledOfferings.reduce((s, o) => s + o.openAssignments, 0),
    openOfferings: catalog.filter((o) => registrationOpen(o)).length,
    pendingCount: catalog.filter(
      (o) => o.myStatus === "Submitted" || o.myStatus === "Waitlisted",
    ).length,
    upcoming: upcomingSessions.map((s) => ({
      id: s.id,
      offeringId: s.offeringId,
      label: `${s.offeringTitle} · Session ${s.sequence}`,
      when: s.datetime.toLocaleString("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      location: s.location,
    })),
  };

  const myProjectTasks: MyProjectTask[] = assignedTasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project.name,
    projectIconEmoji: t.project.iconEmoji,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    priority: t.priority,
  }));

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

  // Day columns (Sun..Sat) with the calendar date number shown in each header.
  const weekDays: WeekDayDTO[] = Array.from({ length: 7 }).map((_, i) => {
    const dayUtc = new Date(weekStart.getTime() + i * 86_400_000);
    const dy = getZonedYMD(dayUtc, tz);
    return { num: dy.day };
  });

  const weekEvents: HomeWeekEvent[] = [];
  for (const ev of rawEvents) {
    if (ev.allDay) continue; // all-day events don't map onto the hour grid
    const e = getZonedYMD(ev.start, tz);
    const dayMidnight = zonedDayStartUtc(e.year, e.month, e.day, tz);
    const colIdx = Math.round((dayMidnight.getTime() - weekStart.getTime()) / 86_400_000);
    if (colIdx < 0 || colIdx > 6) continue;
    const startHour = (ev.start.getTime() - dayMidnight.getTime()) / 3_600_000;
    const duration = Math.max(0.5, (ev.end.getTime() - ev.start.getTime()) / 3_600_000);
    weekEvents.push({ colIdx, startHour, duration, label: ev.summary });
  }

  return {
    user: auth.user,
    notifications,
    tasks,
    myProjectTasks,
    weekDays,
    weekEvents,
    formsForYou,
    education,
  };
}

type EducationSummary = {
  enrolledCount: number;
  openAssignments: number;
  openOfferings: number;
  pendingCount: number;
  upcoming: {
    id: string;
    offeringId: string;
    label: string;
    when: string;
    location: string | null;
  }[];
};

type MyProjectTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectIconEmoji: string | null;
  dueAt: string | null;
  priority: "Low" | "Normal" | "High" | "Urgent";
};

type WeekDayDTO = { num: number };
type HomeWeekEvent = {
  colIdx: number;
  startHour: number;
  duration: number;
  label: string;
};

export default function Home() {
  const { user, notifications, tasks, myProjectTasks, weekDays, weekEvents, formsForYou, education } =
    useLoaderData<typeof loader>();
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

      <AttentionBanner tasks={tasks} notifications={notifications} />

      <MyTasksPanel tasks={myProjectTasks} />

      <FormsForYouPanel forms={formsForYou} />

      <EducationPanel education={education} />

      <div className="flex flex-col gap-6">
        <WeekCalendarPanel days={weekDays} events={weekEvents} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Education — enrolled courses, next sessions, and open registration.  */
/* Collapses to nothing when the member has no education activity, so    */
/* the widget works for everyone (including non-students).               */
/* ------------------------------------------------------------------ */

function EducationPanel({ education }: { education: EducationSummary }) {
  const { enrolledCount, openAssignments, openOfferings, pendingCount, upcoming } = education;
  if (
    enrolledCount === 0 &&
    openOfferings === 0 &&
    pendingCount === 0 &&
    upcoming.length === 0
  ) {
    return null;
  }
  const blurb =
    enrolledCount > 0
      ? `You're enrolled in ${enrolledCount} course${enrolledCount === 1 ? "" : "s"}${
          openAssignments > 0
            ? ` — ${openAssignments} assignment${openAssignments === 1 ? "" : "s"} waiting on you`
            : ""
        }.`
      : openOfferings > 0
        ? `${openOfferings} workshop${openOfferings === 1 ? " or miniseries is" : "s and miniseries are"} open for registration.`
        : "Workshops and miniseries are posted here each term.";
  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <GraduationCap className="w-4 h-4 text-accent-coral" />
          Education
        </h2>
        <Link to="/education" className={buttonClasses("secondary", "sm")}>
          {enrolledCount > 0 ? "My courses" : "Browse offerings"}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{blurb}</p>
      {(openAssignments > 0 || pendingCount > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {openAssignments > 0 && (
            <span className="inline-flex items-center rounded-full bg-accent-coral text-white px-2.5 py-1 text-xs font-semibold">
              {openAssignments} assignment{openAssignments === 1 ? "" : "s"} due
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold">
              {pendingCount} application{pendingCount === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
          {upcoming.map((s) => (
            <li key={s.id} className="text-xs">
              <Link
                to={`/education/${s.offeringId}/hub`}
                className="font-medium text-foreground hover:underline"
              >
                {s.label}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {s.when}
                {s.location ? ` · ${s.location}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Forms for you — published forms that opted into listing (Form.listed) */
/* and whose audience admits this member. Collapses to nothing when      */
/* there's nothing to show, like the attention banner.                   */
/* ------------------------------------------------------------------ */

function FormsForYouPanel({ forms }: { forms: ListedForm[] }) {
  if (forms.length === 0) return null;
  return (
    <div className="bg-card border border-border shadow-brand-1 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-accent-coral" />
        <span className="font-heading font-semibold text-sm text-foreground">
          Forms for you
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {forms.map((f) => (
          <a
            key={f.id}
            href={f.fillUrl}
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <span className="truncate">{f.name}</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* My tasks — open project-board tasks assigned to the viewer, soonest  */
/* deadline first. Each row deep-links to the task modal on its          */
/* project board. Collapses to nothing when the viewer has none.         */
/* ------------------------------------------------------------------ */

function MyTasksPanel({ tasks }: { tasks: MyProjectTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="bg-card border border-border shadow-brand-1 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className="w-4 h-4 text-accent-coral" />
        <span className="font-heading font-semibold text-sm text-foreground">
          My tasks
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => {
          const url = `/projects/${t.projectId}?tab=board&task=${t.id}`;
          const overdue =
            t.dueAt != null && new Date(t.dueAt).getTime() < Date.now();
          return (
            <a
              key={t.id}
              href={url}
              onClick={(e) => openTaskLink(e, url, t.title)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="truncate text-foreground">{t.title}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground flex-shrink-0 max-w-[30%]">
                <ProjectIcon iconEmoji={t.projectIconEmoji} />
                <span className="truncate">{t.projectName}</span>
              </span>
              <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                {/* Low/Normal are the unremarkable default — only flag work
                    that's High or Urgent, in the board's priority tones. */}
                {(t.priority === "High" || t.priority === "Urgent") && (
                  <span
                    className={`text-[11px] ${
                      t.priority === "Urgent"
                        ? "text-accent-coral font-semibold"
                        : "text-accent-coral"
                    }`}
                  >
                    {t.priority}
                  </span>
                )}
                {t.dueAt && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-md border ${
                      overdue
                        ? "border-accent-coral/40 text-accent-coral bg-accent-coral/10"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    Due {formatDuePill(t.dueAt)}
                  </span>
                )}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// Short label for the due pill: "Mar 12" if it's this year, otherwise
// "Mar 12, 2027" — mirrors the TaskBoard card pill.
function formatDuePill(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
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
  const extraNotifications = notifications.filter((n) => {
    if (taskIds.has(n.id)) return false;
    // A read notification still belongs on the banner only when it's a meeting
    // invite: we keep those so the RSVP/status badge stays reachable. Every
    // other read notification (e.g. an interview assignment already opened, so
    // it's no longer a task) is finished business — its Dismiss can't change
    // anything server-side, so the card would just sit here un-clearable. Drop
    // it so Dismiss actually removes it for good on revalidate.
    if (n.readAt && n.kind !== "MeetingInvite") return false;
    return true;
  });

  // Nothing to surface once duplicates and finished (read, non-invite)
  // notifications are filtered out — render nothing rather than an empty
  // banner with a bare header.
  if (tasks.length === 0 && extraNotifications.length === 0) return null;

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
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
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
/* Task card (the top row of the attention banner)                      */
/*                                                                       */
/* Three shapes, by how the task clears:                                 */
/*   - meeting invite  → RSVP buttons (Accept/Maybe/Decline)             */
/*   - has an attached form (hasAction + link) → link to the form; the   */
/*     submit marks it read, so no Confirm                               */
/*   - everything else → its link (if any) plus a Confirm button that    */
/*     marks the notification read. A bare link doesn't self-clear, so   */
/*     Confirm is how the user says "handled".                           */
/* ------------------------------------------------------------------ */

function TaskCard({ task: t }: { task: Task }) {
  const revalidator = useRevalidator();
  const [confirming, setConfirming] = useState(false);
  const cls =
    "flex-shrink-0 w-56 bg-card border border-border shadow-brand-1 rounded-md px-3 py-2";

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

  // Form tasks self-clear on submit, so the whole tile is the form link and
  // there's no Confirm.
  if (t.hasAction && t.link) {
    return (
      <a
        href={t.link}
        onClick={(e) => openTaskLink(e, t.link!, t.title)}
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
      <div className="flex items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={confirm}
          disabled={confirming}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50"
        >
          <Check className="w-3 h-3" />
          {confirming ? "Confirming…" : "Confirm"}
        </button>
        {t.link && (
          <a
            href={t.link}
            onClick={(e) => openTaskLink(e, t.link!, t.title)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}

// Open a task's link, handling the TabWorkspace iframe case: inside the embed,
// hand the URL to the parent shell so the user lands in a real tab instead of
// being stranded in the chrome-less iframe.
function openTaskLink(
  e: MouseEvent<HTMLAnchorElement>,
  link: string,
  label: string,
) {
  if (link.startsWith("/") && window.self !== window.top) {
    e.preventDefault();
    window.parent.postMessage(
      { type: "dali:openTab", url: link, label },
      window.location.origin,
    );
  }
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
  const revalidator = useRevalidator();
  const isUnread = !notification.readAt;
  const isInvite = notification.kind === "MeetingInvite" && !!notification.scheduledMeetingId;
  const accent = isUnread ? "border-l-accent-coral" : "border-l-accent-teal";
  const [rsvp, setRsvp] = useState<HomeNotification["rsvp"]>(notification.rsvp);
  const [dismissing, setDismissing] = useState(false);

  // Invites clear by RSVP, never by dismiss (the /read endpoint exempts them),
  // so the Dismiss control is offered for every other notification. It marks
  // the row read and revalidates, dropping the card from the banner.
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
          <span className="text-sm font-semibold text-foreground truncate">{notification.title}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {notification.link && (
              <a
                href={notification.link}
                onClick={(e) => {
                  if (!notification.readAt && !isInvite) {
                    // keepalive: true so the POST survives the navigation
                    // that the anchor's default action is about to start.
                    // Meeting invites clear only via RSVP — never via link.
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
            {!isInvite && (
              <button
                type="button"
                onClick={dismiss}
                disabled={dismissing}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
                aria-label="Dismiss notification"
              >
                <Check className="w-3 h-3" />
                {dismissing ? "Dismissing…" : "Dismiss"}
              </button>
            )}
          </div>
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
          <RsvpButtons
            notificationId={notification.id}
            onResponded={setRsvp}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* This-week calendar                                                  */
/* ------------------------------------------------------------------ */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const HOUR_PX = 44;
const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Fixed dark text that doesn't flip in dark mode — paired only with the light
// accent tints below so it stays high-contrast in both themes. (The saturated
// `accent-teal` made dark text hard to read in light mode; use its light twin.)
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
// Cycle a few light accent fills so adjacent events are visually distinguishable.
const EVENT_FILLS = [
  `bg-accent-teal-light ${EVENT_TEXT}`,
  `bg-accent-coral-light ${EVENT_TEXT}`,
  `bg-accent-green ${EVENT_TEXT}`,
];

function WeekCalendarPanel({
  days,
  events,
}: {
  days: WeekDayDTO[];
  events: HomeWeekEvent[];
}) {
  const hasEvents = events.length > 0;
  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          This Week
          <span className="text-xs font-normal text-muted-foreground">
            · DALI General Calendar
          </span>
        </h2>
      </div>
      {!hasEvents && (
        <p className="mb-2 text-xs text-muted-foreground">
          No events this week, or the DALI General Calendar isn't connected yet.
        </p>
      )}
      <div className="flex border border-border rounded-md overflow-hidden">
        <div className="flex flex-col w-12 border-r border-border bg-card text-[10px] text-muted-foreground">
          <div className="h-9 border-b border-border" />
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="px-1.5 pt-0.5 text-right">
              {formatHour(h)}
            </div>
          ))}
        </div>
        {DAY_KEYS.map((key, idx) => (
          <div key={key} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
            <div className="flex flex-col items-center justify-center border-b border-border h-9">
              <div className="text-[9px] font-semibold text-muted-foreground tracking-wide">
                {key}
              </div>
              <div className="text-xs font-bold text-foreground">{days[idx]?.num ?? ""}</div>
            </div>
            <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {events
                .filter((e) => e.colIdx === idx)
                .map((e, i) => {
                  // Clamp to the visible 9am–10pm window so off-hours events
                  // still show a sliver at the grid edge rather than overflow.
                  const top = Math.max(0, (e.startHour - HOURS[0]) * HOUR_PX);
                  const rawHeight = e.duration * HOUR_PX;
                  const maxHeight = HOURS.length * HOUR_PX - top;
                  const height = Math.min(rawHeight, maxHeight);
                  const start = formatBlockTime(e.startHour);
                  const end = formatBlockTime(e.startHour + e.duration);
                  return (
                    <div
                      key={i}
                      // Inset left edge gives the flat tint some depth and mirrors
                      // the /calendar blocks, so home reads as the same system.
                      className={`absolute left-0 right-0 mx-0.5 px-1.5 py-0.5 rounded-sm overflow-hidden shadow-[inset_3px_0_0_0_rgba(0,0,0,0.16)] ${
                        EVENT_FILLS[i % EVENT_FILLS.length]
                      }`}
                      style={{ top, height }}
                      title={`${e.label} · ${start} – ${end}`}
                    >
                      <span className="block text-[10px] font-semibold leading-tight break-words">
                        {e.label}
                      </span>
                      {/* Start time only once the block is tall enough for a
                          second line — short events stay name-only. */}
                      {height >= 26 && (
                        <span className="block text-[9px] font-medium leading-tight opacity-70">
                          {start}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Format a fractional hour-of-day (e.g. 14.5) as "2:30 PM" for event blocks.
function formatBlockTime(hour: number) {
  const h24 = Math.floor(hour);
  const mins = Math.round((hour - h24) * 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mins === 0
    ? `${h12} ${period}`
    : `${h12}:${String(mins).padStart(2, "0")} ${period}`;
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}
