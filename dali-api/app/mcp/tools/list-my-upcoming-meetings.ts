// MCP `list_my_upcoming_meetings` — returns ScheduledMeeting + Interview
// occurrences the authenticated user is involved in within the next N days.
// Thin wrapper over listUpcomingMeetings (app/lib/upcoming-meetings.ts),
// which also backs the desktop tray's agenda card.
// Requires the `mcp:read` scope.

import { listUpcomingMeetings } from "~/lib/upcoming-meetings";

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

export async function runListMyUpcomingMeetings(userId: string, input: Input) {
  const daysAhead = Math.min(Math.max(input.daysAhead ?? 7, 1), 30);
  const now = new Date();
  const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const rows = await listUpcomingMeetings(userId, now, windowEnd);

  return {
    meetings: rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      location: r.location,
      meetingUrl: r.meetingUrl,
      attendeeCount: r.attendeeCount,
      source: r.source,
    })),
  };
}
