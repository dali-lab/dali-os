import { redirect } from "react-router";
import { Link } from "react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Plus } from "lucide-react";
import type { Route } from "./+types/core.hub";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin, currentTermMemberWhere } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";
import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { loadShellUser } from "~/lib/shell-user.server";
import { resolveUserTimeZone } from "~/lib/timezone";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { coreCalendarMeetingWhere } from "~/core/lib/core-calendar";
import { listCalendarsForLink } from "~/lib/google-calendar";
import { listAllGroups } from "~/lib/groups";

import { MiniMonth } from "~/calendar/components/MiniMonth";
import { MonthGrid } from "~/calendar/components/MonthGrid";
import { AgendaView } from "~/calendar/components/AgendaView";
import { WeekGrid, type AllDayBlock } from "~/calendar/components/WeekGrid";
import { ADD_EVENT_BTN, EVENT_TEXT, EVENT_CORAL } from "~/calendar/lib/event-block";
import { placeBlock } from "~/calendar/lib/layers";
import { fetchWindow, parseAnchor } from "~/calendar/lib/view-window";
import { useCalendarView } from "~/calendar/lib/use-calendar-view";
import type {
  CalendarView, EventAttendeeDTO, EventBlock, EventMeetingDTO, EventRsvpTarget,
} from "~/calendar/lib/types";
import { CreateCoreEventModal } from "~/core/components/CreateCoreEventModal";
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

/** One thing on the Core calendar, in the shape the grids place blocks from.
 *  Carries the same detail the Events page's popover shows, so clicking a block
 *  reads the same on both calendars. */
type CoreCalendarEvent = {
  id: string;
  kind: "meeting" | "general";
  title: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizerName: string | null;
  /** Join link (a meeting's Meet URL) and the event's own web page. */
  meetingUrl: string | null;
  url: string | null;
  attendees: EventAttendeeDTO[];
  /** Set on meetings: the notes doc, the attendance page, the timesheet toggle. */
  meeting: EventMeetingDTO | null;
  /** The viewer's invite, when they have one — answered through the same
   *  endpoint the notification bell uses, which pushes on to Google. */
  rsvp: EventRsvpTarget | null;
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

  const [meetings, generalEvents, deadlineRows, calendarLinks, groups, termMembers] =
    await Promise.all([
    prisma.scheduledMeeting.findMany({
      where: coreCalendarMeetingWhere(coreGroup?.id ?? null),
      select: {
        id: true,
        title: true,
        selectedAt: true,
        durationMinutes: true,
        recurrenceRule: true,
        meetingUrl: true,
        organizerId: true,
        participantUserIds: true,
        organizer: { select: { firstName: true, lastName: true } },
        notePage: { select: { id: true, title: true } },
        // The guest list and everyone's answer: an invite notification per
        // recipient is where a DALI meeting keeps its RSVPs.
        notifications: {
          where: { kind: "MeetingInvite" },
          select: { id: true, recipientUserId: true, rsvp: true },
        },
        timeEntries: { where: { userId: auth.user.sub }, select: { id: true }, take: 1 },
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
    // The create modal's "Send invite from" list: a Core meeting is a real
    // Google invite to members' DALI Gmail, so it needs the organizer's linked
    // accounts. Enabled Google links only — nothing else can send an invite.
    prisma.userCalendarLink
      .findMany({
        where: { userId: auth.user.sub, provider: "Google", enabled: true },
        select: { id: true, externalEmail: true, displayName: true },
        orderBy: { linkedAt: "asc" },
      })
      // An account is not a destination: a Google account holds several
      // calendars, and "which calendar does this land on?" is the question the
      // organizer is actually answering. Only the writable ones — Google
      // refuses an insert into anything the account can merely read.
      .then((links) =>
        Promise.all(
          links.map(async (l) => {
            try {
              const items = await listCalendarsForLink(l.id);
              return {
                ...l,
                calendars: items
                  .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
                  .map((c) => ({
                    id: c.id,
                    summary: c.summary,
                    primary: c.primary === true,
                  })),
              };
            } catch {
              // Token trouble or a Google outage: the account still sends from
              // its primary calendar, which is what an unlisted link means.
              return { ...l, calendars: [] };
            }
          }),
        ),
      ),
    // The invite picker is the Events page's, so it needs the same two lists:
    // every active group, and the people a Core organizer can name.
    listAllGroups().then((rows) =>
      rows
        .filter((r) => !r.archived)
        .map((r) => ({
          id: r.id,
          name: r.name,
          memberIds: r.memberIds,
          projectId: r.dynamicQuery?.startsWith("project:")
            ? r.dynamicQuery.slice("project:".length)
            : null,
          systemKey: r.systemKey ?? null,
        })),
    ),
    currentTermMemberWhere(request).then((where) =>
      prisma.user.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, daliEmail: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ),
  ]);

  // A group roster can name people outside the current term (alumni, inactive
  // members), and the picker renders a raw cuid for anyone it can't name.
  const knownIds = new Set(termMembers.map((u) => u.id));
  const missingIds = Array.from(
    new Set(groups.flatMap((g) => g.memberIds).filter((id) => !knownIds.has(id))),
  );
  const users = [
    ...termMembers,
    ...(missingIds.length
      ? await prisma.user.findMany({
          where: { id: { in: missingIds } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        })
      : []),
  ];

  const events: CoreCalendarEvent[] = [];
  const upcoming: {
    id: string;
    title: string;
    startAt: string;
    notePageId: string | null;
  }[] = [];

  // Everyone named on a Core meeting, so the guest list can show names rather
  // than ids. `users` above covers current-term members; this picks up the rest
  // (alumni, anyone off-term) in one query.
  const namedIds = new Map(users.map((u) => [u.id, fullName(u)]));
  const guestIds = new Set(
    meetings.flatMap((m) => [m.organizerId, ...m.participantUserIds]).filter((id) => !namedIds.has(id)),
  );
  if (guestIds.size > 0) {
    for (const u of await prisma.user.findMany({
      where: { id: { in: [...guestIds] } },
      select: { id: true, firstName: true, lastName: true },
    })) {
      namedIds.set(u.id, fullName(u));
    }
  }

  for (const m of meetings) {
    const organizerName = fullName(m.organizer) || null;
    const rsvpByUser = new Map(m.notifications.map((n) => [n.recipientUserId, n.rsvp]));
    // The organizer reads as attending without having answered anything —
    // Google says the same about the person who called the meeting.
    const attendees: EventAttendeeDTO[] = [
      { name: organizerName || "Organizer", status: "Accepted" as const, organizer: true },
      ...m.participantUserIds
        .filter((uid) => uid !== m.organizerId)
        .map((uid) => ({
          name: namedIds.get(uid) || "Guest",
          status: (rsvpByUser.get(uid) ?? "Pending") as EventAttendeeDTO["status"],
        })),
    ];
    const myInvite = m.notifications.find((n) => n.recipientUserId === auth.user.sub);
    const meeting: EventMeetingDTO = {
      meetingId: m.id,
      notePageId: m.notePage?.id ?? null,
      onTimesheet: m.timeEntries.length > 0,
      isCoreMeeting: true,
      // Everything on this calendar is here *because* it's a Core meeting, so
      // clearing the flag from here would delete the block you clicked.
      canMarkCoreMeeting: false,
      // The toggles are the Events page's action; the Core hub only shows them.
      actionPath: "/calendar",
    };
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
          // A meeting has a join link, not a place.
          location: null,
          description: null,
          organizerName,
          meetingUrl: m.meetingUrl,
          url: null,
          attendees,
          meeting,
          rsvp: myInvite
            ? {
                via: "notification" as const,
                status: myInvite.rsvp ?? "Pending",
                notificationId: myInvite.id,
              }
            : null,
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
      description: g.description,
      organizerName: g.organizer,
      meetingUrl: null,
      url: g.url,
      // The lab feed is read-only: no guest list to show and nothing to answer.
      attendees: [],
      meeting: null,
      rsvp: null,
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
    coreGroupId: coreGroup?.id ?? null,
    calendarLinks,
    groups,
    users,
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
  const { timeZone, events, upcoming, deadlines, coreGroupId, calendarLinks, users, groups } =
    loaderData;
  const { pageTitle } = useOsChrome();
  const { view, days, focusDate, anchorMonth, rangeLabel, changeView, navigate, goToday, goToDay } =
    useCalendarView(timeZone);
  const [creating, setCreating] = useState(false);

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
        description: ev.description ?? undefined,
        organizerName: ev.organizerName ?? undefined,
        attendees: ev.attendees.length > 0 ? ev.attendees : undefined,
        // The notes doc rides on `meeting` (the popover's meeting row), so it
        // isn't repeated here.
        links: [
          ...(ev.meetingUrl
            ? [{ label: "Join video call", href: ev.meetingUrl, kind: "video" as const }]
            : []),
          ...(ev.url ? [{ label: "Open event", href: ev.url, kind: "source" as const }] : []),
        ],
        meeting: ev.meeting ?? undefined,
        rsvp: ev.rsvp ?? undefined,
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

          {/* Last in the row, same capsule as the Events page's — the two
              calendars open their create flow from the same control. Everything
              it makes is a Core entry; see CreateCoreEventModal. */}
          <button type="button" onClick={() => setCreating(true)} className={ADD_EVENT_BTN}>
            <Plus className="h-4 w-4 stroke-[3]" />
            Add event
          </button>
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

      {creating && (
        <CreateCoreEventModal
          coreGroupId={coreGroupId}
          calendarLinks={calendarLinks}
          users={users}
          groups={groups}
          initialDateLocal={defaultStartLocal(focusDate)}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/** Seed the create form with 9am on the day the grid is focused, so the common
 *  case ("something this week") needs no date picking at all. */
function defaultStartLocal(focusDate: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${focusDate.getUTCFullYear()}-${pad(focusDate.getUTCMonth() + 1)}` +
    `-${pad(focusDate.getUTCDate())}T09:00`
  );
}
