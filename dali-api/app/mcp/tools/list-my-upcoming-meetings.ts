// MCP `list_my_upcoming_meetings` — returns ScheduledMeeting + Interview
// occurrences the authenticated user is involved in within the next N days.
// Reads directly from the calendar/hiring tables — no helper exists in the app
// today because the calendar UI is per-week-grid, not "next-N-days inbox".
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { expandOccurrences } from "~/lib/meeting-occurrences";

export const LIST_MY_UPCOMING_MEETINGS_TOOL = {
  name: "list_my_upcoming_meetings",
  description:
    "Return meetings the authenticated DALI OS member is invited to or attending in a forward window. Includes scheduled meetings and assigned interviews.",
  inputSchema: {
    type: "object" as const,
    properties: {
      daysAhead: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        description: "How many days into the future to scan (default 7, max 30).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { daysAhead?: number };

type MeetingOut = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  meetingUrl: string | null;
  attendeeCount: number;
  source: "dali" | "interview";
};

export async function runListMyUpcomingMeetings(userId: string, input: Input) {
  const daysAhead = Math.min(Math.max(input.daysAhead ?? 7, 1), 30);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

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

  const out: MeetingOut[] = [];

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
      location: iv.location,
      meetingUrl: iv.videoUrl,
      attendeeCount: iv.assignments.length + 1, // interviewers + applicant
      source: "interview",
    });
  }

  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { meetings: out };
}
