import { redirect } from "react-router";
import { Link } from "react-router";
import { CalendarClock, FileText, Flag } from "lucide-react";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { loadShellUser } from "~/lib/shell-user.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import {
  WeekCalendarPanel,
  formatWeekRange,
  type WeekEvent,
} from "~/components/WeekCalendarPanel";
import {
  generalCalendarWeekEvents,
  resolveWeekWindow,
  toWeekEvent,
} from "~/lib/week-events";
import { CORE_CLUSTERS, coreHandle } from "~/core/coreNav";

// Core's landing page: the week Core is running, not a menu. The grid merges
// the meetings scoped to the Core group (each linking to its notes page) with
// the lab-wide DALI General Calendar, so "what is Core doing this week" and
// "what is the lab doing this week" answer in one place.

export const handle = coreHandle("hub");

export const meta: Route.MetaFunction = () => [{ title: "Core · DALI OS" }];

// A recurring meeting's occurrences can be moved by an exception, so scan a day
// either side of the window and let the mapper drop what lands outside it.
const OCCURRENCE_GUARD_MS = 86_400_000;
const DEADLINE_WINDOW_DAYS = 30;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const me = await loadShellUser(auth.user.sub, request);
  const timeZone = resolveUserTimeZone(me);
  const now = new Date();
  const { weekOffset, weekStart, weekEnd, weekDays } = resolveWeekWindow(
    request,
    timeZone,
    now,
  );

  // There is no "Core" meeting scope — a Core meeting is one scoped to the
  // system group whose systemKey is "core" (app/lib/groups.ts).
  const coreGroup = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });

  const [meetings, generalEvents, deadlineRows] = await Promise.all([
    coreGroup
      ? prisma.scheduledMeeting.findMany({
          where: {
            scopeType: "Group",
            scopeId: coreGroup.id,
            status: { not: "Cancelled" },
          },
          select: {
            id: true,
            title: true,
            selectedAt: true,
            durationMinutes: true,
            recurrenceRule: true,
            organizer: { select: { firstName: true, lastName: true } },
            notePage: { select: { id: true, title: true } },
            exceptions: {
              select: {
                originalStart: true,
                overrideStart: true,
                overrideDurationMin: true,
                cancelled: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    // Never throws: returns [] when the feed is unconfigured, and serves stale
    // data rather than failing when the fetch does.
    fetchGeneralCalendarEvents(weekStart, weekEnd),
    // Announcements fan out one Notification row per recipient, so the same
    // deadline appears many times — collapse them below.
    prisma.notification.findMany({
      where: {
        kind: "SystemAnnouncement",
        dueAt: {
          gte: now,
          lt: new Date(now.getTime() + DEADLINE_WINDOW_DAYS * 86_400_000),
        },
      },
      select: { title: true, dueAt: true, link: true },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  const meetingEvents: WeekEvent[] = [];
  const upcoming: {
    id: string;
    title: string;
    startAt: string;
    notePageId: string | null;
  }[] = [];

  for (const m of meetings) {
    const occurrences = expandOccurrences(
      m,
      m.exceptions,
      new Date(weekStart.getTime() - OCCURRENCE_GUARD_MS),
      new Date(weekEnd.getTime() + OCCURRENCE_GUARD_MS),
    );
    for (const occ of occurrences) {
      const href = m.notePage ? `/documents/${m.notePage.id}` : null;
      const mapped = toWeekEvent(
        {
          id: `${m.id}:${occ.originalStart.toISOString()}`,
          kind: "meeting",
          label: m.title,
          start: occ.start,
          end: occ.end,
          organizer: m.organizer
            ? `${m.organizer.firstName} ${m.organizer.lastName}`
            : null,
          href,
        },
        weekStart,
        timeZone,
      );
      if (mapped) meetingEvents.push(mapped);
      if (occ.start >= now) {
        upcoming.push({
          id: `${m.id}:${occ.originalStart.toISOString()}`,
          title: m.title,
          startAt: occ.start.toISOString(),
          notePageId: m.notePage?.id ?? null,
        });
      }
    }
  }
  upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));

  // One row per (title, dueAt) — the recipient fan-out is noise here.
  const seen = new Set<string>();
  const deadlines = deadlineRows
    .filter((d) => {
      const key = `${d.title}|${d.dueAt?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((d) => ({
      title: d.title,
      dueAt: d.dueAt!.toISOString(),
      link: d.link,
    }));

  return {
    isAdmin: await isAdmin(auth.user.sub),
    timeZone,
    weekOffset,
    weekDays,
    weekLabel: formatWeekRange(weekStart, timeZone),
    events: [
      ...meetingEvents,
      ...generalCalendarWeekEvents(generalEvents, weekStart, timeZone),
    ],
    upcoming: upcoming.slice(0, 5),
    deadlines,
  };
}

export default function CoreHub({ loaderData }: Route.ComponentProps) {
  const { timeZone, weekOffset, weekDays, weekLabel, events, upcoming, deadlines } =
    loaderData;

  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));

  const dueWhen = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone,
    }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Core</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The week Core is running — meetings and their notes, lab events, and
          what&apos;s coming due.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WeekCalendarPanel
          days={weekDays}
          events={events}
          weekOffset={weekOffset}
          weekLabel={weekLabel}
          timeZone={timeZone}
          basePath="/core"
          sourceLabel="Core meetings + DALI General Calendar"
          emptyLabel="No Core meetings or lab events this week."
        />

        <div className="flex flex-col gap-4">
          <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
            <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
              <CalendarClock className="w-4 h-4 text-accent-coral" />
              Upcoming Core meetings
            </h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing scheduled for the Core group.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {upcoming.map((m) => (
                  <li key={m.id} className="text-sm">
                    <div className="font-medium text-foreground">{m.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {when(m.startAt)}
                    </div>
                    {m.notePageId ? (
                      <Link
                        to={`/documents/${m.notePageId}`}
                        prefetch="intent"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        Meeting notes
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
            <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
              <Flag className="w-4 h-4 text-accent-coral" />
              Deadlines
            </h2>
            {deadlines.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No announcement deadlines in the next month.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {deadlines.map((d) => (
                  <li key={`${d.title}-${d.dueAt}`} className="text-sm">
                    {d.link ? (
                      <Link
                        to={d.link}
                        prefetch="intent"
                        className="font-medium text-foreground hover:underline"
                      >
                        {d.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{d.title}</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Due {dueWhen(d.dueAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-foreground">Core tools</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_TOOLS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              prefetch="intent"
              className="bg-card border border-border shadow-brand-1 rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-brand-2 transition-all"
            >
              <h3 className="font-heading font-semibold text-foreground">
                {t.label}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

// The flat process pages, plus each cluster's entry point pulled straight from
// CORE_CLUSTERS so the hub can't drift from the sidebar.
const CORE_TOOLS: { label: string; to: string; description: string }[] = [
  {
    label: "Staffing",
    to: "/core/staffing",
    description: "Assign members to project roles for the term's staffing cycle.",
  },
  {
    label: "Intent to Work",
    to: "/core/intent-to-work",
    description: "Who intends to work this cycle, and on what.",
  },
  {
    label: "Project Bids",
    to: "/core/project-bids",
    description: "Which projects each member bid on.",
  },
  {
    label: "Level Up",
    to: "/core/level-up",
    description: "Level-up requests and the promotions they ask for.",
  },
  ...CORE_CLUSTERS.map((c) => ({
    label: c.label,
    to: c.hubPath ?? c.sections[0]!.to,
    description: c.description,
  })),
  {
    label: "Attendance",
    to: "/core/attendance",
    description: "Self check-in events — who was invited and who checked in.",
  },
];
