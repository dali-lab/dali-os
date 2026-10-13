import { prisma } from "~/lib/db";
import type { MonthDayDTO, MonthEvent } from "~/components/MonthCalendarPanel";
import {
  monthDayIndex,
  resolveMonthWindow,
  toMonthEvent,
} from "~/lib/week-events";
import { expandOccurrences, noteForOccurrence } from "~/lib/meeting-occurrences";
import { resolveUserTimeZone } from "~/lib/timezone";
import type { TimelineSprint } from "~/projects/components/EpicsTimeline";

// The month grid on a project's Meetings tab: everything booked on the
// project's calendar identity, plus its sprint boundaries, on one grid.
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
  /** Already built for the planning timeline. */
  sprints: TimelineSprint[];
  now?: Date;
}): Promise<ProjectCalendar> {
  const { request, viewerId, projectId, calendarEmail, sprints } = opts;
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
      notePages: { select: { id: true, meetingOccurrenceStart: true } },
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
      const note = noteForOccurrence(m.notePages, occ.originalStart);
      const mapped = toMonthEvent(
        {
          id: `${m.id}:${occ.originalStart.toISOString()}`,
          kind: "meeting",
          label: m.title,
          start: occ.start,
          // Clicking the chip opens that occurrence's notes when it has any.
          href: note ? `/documents/${note.id}` : null,
        },
        dayIndexByKey,
        timeZone,
      );
      if (mapped) events.push(mapped);
    }
  }

  for (const sp of sprints) {
    for (const [edge, iso] of [["starts", sp.startsOn], ["ends", sp.endsOn]] as const) {
      const mapped = toMonthEvent(
        { id: `sprint:${sp.id}:${edge}`, kind: "sprint", label: `${sp.label} ${edge}`, start: new Date(iso), allDay: true },
        dayIndexByKey,
        timeZone,
      );
      if (mapped) events.push(mapped);
    }
  }

  return { timeZone, monthOffset, monthDays, monthLabel, events, calendarEmail };
}
