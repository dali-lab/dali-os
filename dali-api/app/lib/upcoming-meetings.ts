// Shared ScheduledMeeting + Interview occurrence expansion for "what's next"
// surfaces: the MCP list_my_upcoming_meetings tool and the desktop tray's
// agenda card (GET /api/desktop/agenda). Reads directly from the
// calendar/hiring tables — no helper existed before because the calendar UI
// is per-week-grid, not "next-N-days inbox".

import { prisma } from "~/lib/db";
import { expandOccurrences } from "~/lib/meeting-occurrences";

export type UpcomingMeeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  meetingUrl: string | null;
  attendeeCount: number;
  source: "dali" | "interview";
  /** ISO start of this occurrence, same value as startsAt. */
  occurrenceStart: string;
  /** The ScheduledMeeting id for a "dali" row, else null. */
  scheduledMeetingId: string | null;
};

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
      OR: [
        { organizerId: userId },
        { participantUserIds: { has: userId } },
      ],
    },
    include: { exceptions: true },
    take: 200,
  });

  const out: UpcomingMeeting[] = [];

  for (const m of meetings) {
    const attendeeCount = new Set([m.organizerId, ...m.participantUserIds]).size;
    if (!m.selectedAt) continue; // still in Searching state with no start time

    const candidates = expandOccurrences(m, m.exceptions, now, windowEnd);

    for (const c of candidates) {
      if (c.end <= now || c.start >= windowEnd) continue;
      out.push({
        id: m.id,
        title: m.title,
        startsAt: c.start.toISOString(),
        endsAt: c.end.toISOString(),
        location: null,
        meetingUrl: m.meetingUrl,
        attendeeCount,
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
        select: { id: true },
      },
    },
    take: 100,
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
      source: "interview",
      occurrenceStart: iv.startTime.toISOString(),
      scheduledMeetingId: null,
    });
  }

  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}
