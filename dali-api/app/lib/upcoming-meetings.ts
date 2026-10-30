// Shared ScheduledMeeting + Interview occurrence expansion for "what's next"
// surfaces: the MCP list_my_upcoming_meetings tool and the desktop tray's
// agenda card (GET /api/desktop/agenda). Reads directly from the
// calendar/hiring tables — no helper existed before because the calendar UI
// is per-week-grid, not "next-N-days inbox".

import { prisma } from "~/lib/db.server";
import { expandOccurrences } from "~/lib/meeting-occurrences";

export type UpcomingMeeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  meetingUrl: string | null;
  attendeeCount: number;
  attendeeIds: string[];
  description: string | null;
  /** Google event id / iCalUID of the mirrored calendar event, for de-duplicating external reads. */
  externalEventId: string | null;
  iCalUID: string | null;
  source: "dali" | "interview";
  /** ISO start of this occurrence, same value as startsAt. */
  occurrenceStart: string;
  /** The ScheduledMeeting id for a "dali" row, else null. */
  scheduledMeetingId: string | null;
};

const MAX_MEETING_MINUTES = 480;
const MEETING_ROW_CAP = 200;

/**
 * Meetings the user is invited to or attending whose occurrence falls in
 * [now, windowEnd]: ScheduledMeeting occurrences (organizer or participant)
 * and assigned Interviews, sorted by start.
 */
export async function listUpcomingMeetings(
  userId: string,
  now: Date,
  windowEnd: Date,
): Promise<UpcomingMeeting[]> {
  // (1) ScheduledMeeting — user is organizer OR in participantUserIds.
  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      status: { not: "Cancelled" },
      AND: [
        { OR: [{ organizerId: userId }, { participantUserIds: { has: userId } }] },
        {
          OR: [
            { recurrenceRule: { not: null } },
            {
              selectedAt: {
                gte: new Date(now.getTime() - MAX_MEETING_MINUTES * 60_000),
                lt: windowEnd,
              },
            },
          ],
        },
      ],
    },
    include: { exceptions: true, rooms: { select: { name: true } } },
    // Newest first: only recurring series can reach the cap, and a series' end
    // lives in its rule string, so this sheds the oldest (likely ended) ones.
    orderBy: [{ selectedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: MEETING_ROW_CAP,
  });

  const out: UpcomingMeeting[] = [];

  for (const m of meetings) {
    const attendeeIds = [...new Set([m.organizerId, ...m.participantUserIds])];
    const attendeeCount = attendeeIds.length;
    const location = m.location ?? (m.rooms.length ? m.rooms.map((r) => r.name).join(", ") : null);
    if (!m.selectedAt) continue; // still in Searching state with no start time

    const candidates = expandOccurrences(m, m.exceptions, now, windowEnd);

    for (const c of candidates) {
      if (c.end <= now || c.start >= windowEnd) continue;
      out.push({
        id: m.id,
        title: m.title,
        startsAt: c.start.toISOString(),
        endsAt: c.end.toISOString(),
        location,
        meetingUrl: m.meetingUrl,
        attendeeCount,
        attendeeIds,
        description: m.description ?? null,
        externalEventId: m.externalEventId ?? null,
        iCalUID: m.iCalUID ?? null,
        source: "dali",
        occurrenceStart: c.start.toISOString(),
        scheduledMeetingId: m.id,
      });
    }
  }

  // (2) Interview — user is assigned as a CycleInterviewer.
  const interviews = await prisma.interview.findMany({
    where: {
      status: "Scheduled",
      startTime: { gte: now, lte: windowEnd },
      assignments: {
        some: {
          status: "Active",
          cycleInterviewer: { userId },
        },
      },
    },
    include: {
      room: { select: { name: true } },
      assignments: {
        where: { status: "Active" },
        select: { id: true, cycleInterviewer: { select: { userId: true } } },
      },
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
  });

  for (const iv of interviews) {
    out.push({
      id: iv.id,
      title: "Interview",
      startsAt: iv.startTime.toISOString(),
      endsAt: iv.endTime.toISOString(),
      location: iv.room?.name ?? null,
      meetingUrl: iv.videoUrl,
      attendeeCount: iv.assignments.length + 1, // interviewers + applicant
      attendeeIds: iv.assignments.map((a) => a.cycleInterviewer.userId),
      description: null,
      externalEventId: null,
      iCalUID: null,
      source: "interview",
      occurrenceStart: iv.startTime.toISOString(),
      scheduledMeetingId: null,
    });
  }

  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}
