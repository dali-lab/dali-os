import { prisma } from "~/lib/db";
import type { MonthDayDTO, MonthEvent } from "~/components/MonthCalendarPanel";
import {
  monthDayIndex,
  resolveMonthWindow,
  toMonthEvent,
} from "~/lib/week-events";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { resolveUserTimeZone } from "~/lib/timezone";
import type { TimelineEpic } from "~/projects/components/EpicsTimeline";

// The month grid on a project's Meetings tab: everything booked on the
// project's calendar identity, plus the epic and story deadlines the planning
// timeline draws, on one grid.
//
// Meetings come from our own ScheduledMeeting rows rather than from Google.
// Every meeting records the calendar identity that owns it
// (`ownerCalendarEmail`, resolved from the scope at create time), so a meeting
// booked on the project's calendar is already ours to read — no Workspace
// scope, no impersonation, no second source of truth to drift from. The
// trade-off is the honest one: an event somebody created directly in Google
// Calendar, outside DALI, is not here. Surfacing those would need calendar
// read access delegated to the service account, which is a Workspace admin
// grant rather than a code change.

// A recurring meeting's occurrences can be moved by an exception, so scan a day
// either side of the window and let the mapper drop what lands outside it.
const OCCURRENCE_GUARD_MS = 86_400_000;

export type ProjectCalendar = {
  timeZone: string;
  monthOffset: number;
  monthDays: MonthDayDTO[];
  monthLabel: string;
  events: MonthEvent[];
  /** Echoed back so the panel can name the identity it is showing. */
  calendarEmail: string | null;
};

export async function buildProjectCalendar(opts: {
  request: Request;
  viewerId: string;
  projectId: string;
  calendarEmail: string | null;
  /** Already built for the planning timeline — the deadline source. */
  epics: TimelineEpic[];
  now?: Date;
}): Promise<ProjectCalendar> {
  const { request, viewerId, projectId, calendarEmail, epics } = opts;
  const now = opts.now ?? new Date();

  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { timeZone: true },
  });
  const timeZone = resolveUserTimeZone(viewer);

  const { monthOffset, gridStart, gridEnd, monthDays, monthLabel } =
    resolveMonthWindow(request, timeZone, now);
  const dayIndexByKey = monthDayIndex(monthDays);

  // Either link counts: a meeting tagged with this project, or one booked on
  // the project's calendar identity. A project meeting scheduled before the
  // projectId link existed only has the second.
  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      selectedAt: { not: null },
      OR: [
        { projectId },
        ...(calendarEmail ? [{ ownerCalendarEmail: calendarEmail }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      notePage: { select: { id: true } },
      exceptions: {
        select: {
          originalStart: true,
          overrideStart: true,
          overrideDurationMin: true,
          cancelled: true,
        },
      },
    },
  });

  const events: MonthEvent[] = [];

  for (const m of meetings) {
    const occurrences = expandOccurrences(
      m,
      m.exceptions,
      new Date(gridStart.getTime() - OCCURRENCE_GUARD_MS),
      new Date(gridEnd.getTime() + OCCURRENCE_GUARD_MS),
    );
    for (const occ of occurrences) {
      const mapped = toMonthEvent(
        {
          id: `${m.id}:${occ.originalStart.toISOString()}`,
          kind: "meeting",
          label: m.title,
          start: occ.start,
          // Clicking the chip opens the meeting's notes when it has any.
          href: m.notePage ? `/documents/${m.notePage.id}` : null,
        },
        dayIndexByKey,
        timeZone,
      );
      if (mapped) events.push(mapped);
    }
  }

  // Deadlines are the *end* of a span: an epic or story that finishes inside
  // the month lands on its last day. A bar that merely runs through the month
  // has no date here — the timeline is where a span is read.
  for (const epic of epics) {
    const epicEnd = epic.endsAt ? toMonthEvent(
      { id: `epic:${epic.id}`, kind: "epic", label: epic.title, start: new Date(epic.endsAt), allDay: true },
      dayIndexByKey,
      timeZone,
    ) : null;
    if (epicEnd) events.push(epicEnd);

    for (const story of epic.stories) {
      const storyEnd = toMonthEvent(
        {
          id: `story:${story.id}`,
          kind: "story",
          label: story.title,
          start: new Date(story.endsAt),
          allDay: true,
        },
        dayIndexByKey,
        timeZone,
      );
      if (storyEnd) events.push(storyEnd);
    }
  }

  return { timeZone, monthOffset, monthDays, monthLabel, events, calendarEmail };
}
