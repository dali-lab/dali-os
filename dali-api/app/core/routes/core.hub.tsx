import { redirect } from "react-router";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";
import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { loadShellUser } from "~/lib/shell-user.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { coreCalendarMeetingWhere } from "~/core/lib/core-calendar";
import { MiniMonth } from "~/calendar/components/MiniMonth";
import { MonthGrid } from "~/calendar/components/MonthGrid";
import { AgendaView } from "~/calendar/components/AgendaView";
import { WeekGrid, type AllDayBlock } from "~/calendar/components/WeekGrid";
import { EVENT_TEXT, EVENT_CORAL } from "~/calendar/lib/event-block";
import { placeBlock } from "~/calendar/lib/layers";
import { fetchWindow, parseAnchor } from "~/calendar/lib/view-window";
import { useCalendarView } from "~/calendar/lib/use-calendar-view";
import type { CalendarView, EventBlock } from "~/calendar/lib/types";
import { coreHandle } from "~/core/coreNav";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

// Core's landing page: the week Core is running, not a menu. The grid merges
// the meetings scoped to the Core group (each linking to its notes page) with
// the lab-wide DALI General Calendar, so "what is Core doing this week" and
// "what is the lab doing this week" answer in one place.
//
// It draws the Events page's grids (month / week / day / agenda, the mini-month
// rail, the same `?view=`/`?anchor=` paging) so the two calendars read as one
// surface. What it leaves out is everything personal to a viewer: the linked
// Google accounts and the "meet with someone" box have no meaning on a shared
// Core calendar, so the rail carries Core's own upcoming list and deadlines in
// their place.

export const handle = coreHandle("hub");

export const meta: Route.MetaFunction = () => [{ title: "Core · DALI OS" }];

// A recurring meeting's occurrences can be moved by an exception, so scan a day
// either side of the window and let the mapper drop what lands outside it.
const OCCURRENCE_GUARD_MS = 86_400_000;
const DEADLINE_WINDOW_DAYS = 30;
// How far ahead the rail's "Upcoming Core meetings" list looks. Independent of
// the grid window, so paging the calendar back a month doesn't empty it.
const UPCOMING_WINDOW_DAYS = 60;

/** One thing on the Core calendar, in the shape the grids place blocks from. */
type CoreCalendarEvent = {
  id: string;
  kind: "meeting" | "general";
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location: string | null;
  organizerName: string | null;
  /** Meetings with a notes page — the block's one outbound link. */
  notePageId: string | null;
};

/**
 * `view` is resolved on the client, and the window fetched here is wider than
 * any single view of one anchor (see `fetchWindow`), so switching month / week /
 * day needs no round-trip. Only a new anchor does — see shouldRevalidate.
 */
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
  const anchor = parseAnchor(new URL(request.url).searchParams.get("anchor"));
  const { start: gridStart, end: gridEnd } = fetchWindow(timeZone, anchor);
  const upcomingEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 86_400_000);
  // One expansion feeds both the grid and the rail's list, so the scan spans
  // whichever of the two windows reaches further in each direction.
  const scanStart = new Date(Math.min(gridStart.getTime(), now.getTime()) - OCCURRENCE_GUARD_MS);
  const scanEnd = new Date(Math.max(gridEnd.getTime(), upcomingEnd.getTime()) + OCCURRENCE_GUARD_MS);

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

  const events: CoreCalendarEvent[] = [];
  const upcoming: {
    id: string;
    title: string;
    startAt: string;
    notePageId: string | null;
  }[] = [];

  for (const m of meetings) {
    const organizerName = fullName(m.organizer) || null;
    for (const occ of expandOccurrences(m, m.exceptions, scanStart, scanEnd)) {
      const id = `${m.id}:${occ.originalStart.toISOString()}`;
      if (occ.start < gridEnd && occ.end > gridStart) {
        events.push({
          id,
          kind: "meeting",
          title: m.title,
          startIso: occ.start.toISOString(),
          endIso: occ.end.toISOString(),
          allDay: false,
          // Meetings have a join link, not a place — the grid's popover shows
          // the notes link instead, which is the one Core reaches for.
          location: null,
          organizerName,
          notePageId: m.notePage?.id ?? null,
        });
      }
      if (occ.start >= now && occ.start < upcomingEnd) {
        upcoming.push({
          id,
          title: m.title,
          startAt: occ.start.toISOString(),
          notePageId: m.notePage?.id ?? null,
        });
      }
    }
  }
  upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));

  generalEvents.forEach((g, i) => {
    events.push({
      id: `general:${i}:${g.start.toISOString()}`,
      kind: "general",
      title: g.summary,
      startIso: g.start.toISOString(),
      endIso: g.end.toISOString(),
      allDay: g.allDay,
      location: g.location,
      organizerName: g.organizer,
      notePageId: null,
    });
  });

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
    events,
    upcoming: upcoming.slice(0, 5),
    deadlines,
  };
}

/**
 * A view switch moves `view` and nothing else, and the loader's window already
 * covers every view of the current anchor — so there is nothing to refetch, and
 * skipping the revalidation is what makes the toggle repaint immediately.
 * `doc` / `comment` are the page guide's URL state, same story. A new anchor
 * still revalidates.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const cur = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  for (const key of ["view", "doc", "comment"]) {
    cur.delete(key);
    next.delete(key);
  }
  cur.sort();
  next.sort();
  return cur.toString() === next.toString() ? false : defaultShouldRevalidate;
}

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};
// Same source-keyed tints the month panel used, so a Core meeting and a General
// Calendar entry keep the colours they have everywhere else.
const GENERAL_FILL = `bg-accent-teal-light ${EVENT_TEXT}`;

/** One list in the calendar rail, shaped like the Events page's own rail
 *  groups: an eyebrow label straight on the page ground with its rows under it,
 *  not a bordered card. The design draws a rail as one column of lists — a card
 *  per list boxed them into panels the mini-month above them doesn't wear. */
function RailSection({
  title,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  /** Shown in place of the rows when there are none. */
  empty: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {isEmpty ? (
        <p className="px-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{children}</ul>
      )}
    </div>
  );
}

export default function CoreHub({ loaderData }: Route.ComponentProps) {
  const { timeZone, events, upcoming, deadlines } = loaderData;
  const { pageTitle } = useOsChrome();
  const { view, days, focusDate, anchorMonth, rangeLabel, changeView, navigate, goToday, goToDay } =
    useCalendarView(timeZone);

  const eventsByDay: Record<number, EventBlock[]> = {};
  const allDayByDay: Record<number, AllDayBlock[]> = {};
  for (const ev of events) {
    const fill = ev.kind === "meeting" ? EVENT_CORAL : GENERAL_FILL;
    // Month draws everything as a chip, so an all-day entry belongs in the same
    // map there. Week and day have a band above the hour grid for it instead,
    // and agenda lists timed events only — the Events page reads the same way.
    if (ev.allDay && view !== "month") {
      const start = new Date(ev.startIso).getTime();
      const end = new Date(ev.endIso).getTime(); // exclusive
      days.forEach((d, idx) => {
        const dayMs = d.dateUtc.getTime();
        if (start < dayMs + 86_400_000 && end > dayMs) {
          (allDayByDay[idx] ??= []).push({ label: ev.title });
        }
      });
      continue;
    }
    placeBlock(
      days,
      timeZone,
      ev.startIso,
      ev.endIso,
      {
        label: ev.title,
        className: fill,
        location: ev.location ?? undefined,
        organizerName: ev.organizerName ?? undefined,
        links: ev.notePageId
          ? [{ label: "Meeting notes", href: `/documents/${ev.notePageId}` }]
          : undefined,
      },
      eventsByDay,
    );
  }

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

  const navBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <div className={cn("flex flex-col", "gap-3")}>
      <h1 className={pageTitle}>Core hub</h1>

      {/* The date navigator belongs to the grid, so it shares a line with the
          range it is moving — the page title sits above them both. */}
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-xl font-semibold text-foreground">{rangeLabel}</h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" className={navBtn} onClick={() => navigate(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Today
            </button>
            <button type="button" className={navBtn} onClick={() => navigate(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {(["month", "week", "day", "agenda"] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  v === view
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Column-reverse below lg so the grid stays first on a narrow window and
          the rail's lists fall under it — the Events page can simply hide its
          rail there, but Core's carries content that has nowhere else to go. */}
      <div className="flex flex-col-reverse gap-5 lg:h-[calc(100dvh-12rem)] lg:min-h-[24rem] lg:flex-row">
        <aside className="flex w-full min-w-0 shrink-0 flex-col gap-5 overflow-x-hidden lg:w-60 lg:overflow-y-auto">
          <MiniMonth focusDate={focusDate} timezone={timeZone} onPick={goToDay} />

          <RailSection title="Upcoming Core meetings" empty="Nothing scheduled." isEmpty={upcoming.length === 0}>
            {upcoming.map((m) => (
              <li key={m.id} className="rounded-md px-1 py-1">
                <span className="block truncate text-sm text-foreground">{m.title}</span>
                <span className="block text-xs text-muted-foreground">{when(m.startAt)}</span>
                {m.notePageId ? (
                  <Link
                    to={`/documents/${m.notePageId}`}
                    prefetch="intent"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-os-accent hover:underline"
                  >
                    <FileText className="h-3 w-3" />
                    Meeting notes
                  </Link>
                ) : null}
              </li>
            ))}
          </RailSection>

          <RailSection
            title="Deadlines"
            empty="No announcement deadlines in the next month."
            isEmpty={deadlines.length === 0}
          >
            {deadlines.map((d) => (
              <li key={`${d.title}-${d.dueAt}`} className="rounded-md px-1 py-1">
                {d.link ? (
                  <Link
                    to={d.link}
                    prefetch="intent"
                    className="block truncate text-sm text-foreground hover:underline"
                  >
                    {d.title}
                  </Link>
                ) : (
                  <span className="block truncate text-sm text-foreground">{d.title}</span>
                )}
                <span className="block text-xs text-muted-foreground">Due {dueWhen(d.dueAt)}</span>
              </li>
            ))}
          </RailSection>
        </aside>

        {/* No card around the grid — the hour rules and day rules are the only
            structure it needs, exactly as on the Events page. */}
        <section className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          {view === "agenda" ? (
            <AgendaView
              days={days}
              eventsByDay={eventsByDay}
              timezone={timeZone}
              onSelectDay={goToDay}
            />
          ) : view === "month" ? (
            <MonthGrid
              days={days}
              eventsByDay={eventsByDay}
              anchorMonth={anchorMonth}
              timezone={timeZone}
              onSelectDay={goToDay}
            />
          ) : (
            <WeekGrid
              fillAndScroll
              clean
              days={days}
              timezone={timeZone}
              eventsByDay={eventsByDay}
              allDayByDay={allDayByDay}
            />
          )}
        </section>
      </div>
    </div>
  );
}
