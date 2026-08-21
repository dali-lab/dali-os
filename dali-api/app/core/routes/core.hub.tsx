import { redirect } from "react-router";
import { Link } from "react-router";
import { CalendarClock, FileText, Flag } from "lucide-react";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";
import { prisma } from "~/lib/db";
import { loadShellUser } from "~/lib/shell-user.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { coreCalendarMeetingWhere } from "~/core/lib/core-calendar";
import { MonthCalendarPanel } from "~/components/MonthCalendarPanel";
import type { MonthEvent } from "~/components/MonthCalendarPanel";
import {
  generalCalendarMonthEvents,
  monthDayIndex,
  resolveMonthWindow,
  toMonthEvent,
} from "~/lib/week-events";
import { coreHandle } from "~/core/coreNav";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

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
  if (!(await isCore(auth.user.sub))) {
    // Non-Core members don't get the Core hub. If a Core hiring cycle is open
    // and they're eligible to apply, send them to the application (the invite
    // email links here at /core) instead of bouncing them home.
    const activeCore = await getActiveCycle("Core");
    if (activeCore?.currentStatus === "Open" && (await isCoreCycleEligible(auth.user.sub))) {
      return redirect("/core/apply");
    }
    return redirect("/");
  }

  const me = await loadShellUser(auth.user.sub, request);
  const timeZone = resolveUserTimeZone(me);
  const now = new Date();
  const { monthOffset, gridStart, gridEnd, monthDays, monthLabel } =
    resolveMonthWindow(request, timeZone, now);
  const dayIndexByKey = monthDayIndex(monthDays);

  // What counts as a Core meeting — see coreCalendarMeetingWhere.
  const coreGroup = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });

  const [meetings, generalEvents, deadlineRows] = await Promise.all([
    prisma.scheduledMeeting.findMany({
      where: coreCalendarMeetingWhere(coreGroup?.id ?? null),
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
    }),
    // Never throws: returns [] when the feed is unconfigured, and serves stale
    // data rather than failing when the fetch does.
    fetchGeneralCalendarEvents(gridStart, gridEnd),
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

  const monthMeetingEvents: MonthEvent[] = [];
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
      new Date(gridStart.getTime() - OCCURRENCE_GUARD_MS),
      new Date(gridEnd.getTime() + OCCURRENCE_GUARD_MS),
    );
    for (const occ of occurrences) {
      const href = m.notePage ? `/documents/${m.notePage.id}` : null;
      const monthMapped = toMonthEvent(
        {
          id: `${m.id}:${occ.originalStart.toISOString()}`,
          kind: "meeting",
          label: m.title,
          start: occ.start,
          // Clicking the chip opens the meeting's notes when it has any.
          href,
        },
        dayIndexByKey,
        timeZone,
      );
      if (monthMapped) monthMeetingEvents.push(monthMapped);
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
    monthOffset,
    monthDays,
    monthLabel,
    monthEvents: [
      ...monthMeetingEvents,
      ...generalCalendarMonthEvents(generalEvents, dayIndexByKey, timeZone),
    ],
    upcoming: upcoming.slice(0, 5),
    deadlines,
  };
}

export default function CoreHub({ loaderData }: Route.ComponentProps) {
  const { timeZone, monthOffset, monthDays, monthLabel, monthEvents, upcoming, deadlines } =
    loaderData;
  const { os, pageTitle, panel, panelPad, heading, headingIcon } = useOsChrome();

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
    <div className={cn("flex flex-col", os ? "gap-6" : "gap-4")}>
      <header>
        <h1 className={pageTitle}>Core</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MonthCalendarPanel
          days={monthDays}
          events={monthEvents}
          monthOffset={monthOffset}
          monthLabel={monthLabel}
          timeZone={timeZone}
          basePath="/core"
          sourceLabel="Core meetings + DALI General Calendar"
        />

        <div className="flex flex-col gap-4">
          <section className={cn(panel, panelPad)}>
            <h2 className={heading}>
              <CalendarClock className={headingIcon} />
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

          <section className={cn(panel, panelPad)}>
            <h2 className={heading}>
              <Flag className={headingIcon} />
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

    </div>
  );
}
