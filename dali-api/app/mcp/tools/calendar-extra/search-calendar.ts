// MCP `search_calendar` — full-text search over DALI meetings (and optionally
// Google Calendar events). Reuses the logic from api.calendar.search.ts.
// Requires `mcp:read` scope.

import { prisma } from "~/lib/db";
import { searchCalendarEvents } from "~/lib/google-calendar";
import { searchWindow, sortHits } from "~/calendar/lib/search";
import { McpInvalidError } from "../../registry";

const LOCAL_TAKE = 20;

export const SEARCH_CALENDAR_DEF = {
  name: "search_calendar",
  description:
    "Search calendar events by text query. Returns matching DALI meetings the caller is invited to, plus Google Calendar events if the caller has a linked calendar. Set scope='all' to search a wide two-year window (default: near the provided date range).",
  inputSchema: {
    type: "object" as const,
    properties: {
      q: {
        type: "string",
        minLength: 2,
        description: "Search query (minimum 2 characters).",
      },
      scope: {
        type: "string",
        enum: ["near", "all"],
        description: "'near' pads the provided range by 2 weeks (default); 'all' searches a two-year window.",
      },
      rangeStart: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 start of the view range (defaults to now).",
      },
      rangeEnd: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 end of the view range (defaults to now).",
      },
    },
    required: ["q"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  q: string;
  scope?: "near" | "all";
  rangeStart?: string;
  rangeEnd?: string;
};

export async function runSearchCalendar(userId: string, input: Input) {
  if (input.q.length < 2) {
    throw new McpInvalidError("Query must be at least 2 characters");
  }

  const nowIso = new Date().toISOString();
  const rangeStartIso = input.rangeStart ?? nowIso;
  const rangeEndIso = input.rangeEnd ?? nowIso;
  const scope = input.scope ?? "near";

  const like = { contains: input.q, mode: "insensitive" as const };

  const meetingRows = await prisma.notification.findMany({
    where: {
      recipientUserId: userId,
      kind: "MeetingInvite",
      scheduledMeeting: {
        status: { not: "Cancelled" },
        selectedAt: { not: null },
        title: like,
      },
    },
    orderBy: { createdAt: "desc" },
    take: LOCAL_TAKE,
    select: {
      scheduledMeeting: {
        select: { id: true, title: true, selectedAt: true, durationMinutes: true },
      },
    },
  });

  const seenMeeting = new Set<string>();
  const localHits: {
    id: string;
    source: "meeting";
    title: string;
    startIso: string;
    endIso: string;
    allDay: boolean;
    location: null;
    recurring: boolean;
  }[] = [];

  for (const row of meetingRows) {
    const m = row.scheduledMeeting;
    if (!m?.selectedAt || seenMeeting.has(m.id)) continue;
    seenMeeting.add(m.id);
    const start = m.selectedAt;
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);
    localHits.push({
      id: `meeting:${m.id}`,
      source: "meeting",
      title: m.title,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      allDay: false,
      location: null,
      recurring: false,
    });
  }

  const local = sortHits(localHits, nowIso);

  let google: ReturnType<typeof sortHits> = [];
  let googleError: string | null = null;

  try {
    const { start, end } = searchWindow(scope, rangeStartIso, rangeEndIso, nowIso);
    const events = await searchCalendarEvents(userId, input.q, start, end);
    const googleHits = events.map((e) => ({
      id: `google:${e.calendarId}:${e.eventId}:${e.startIso}`,
      source: "google" as const,
      title: e.title,
      startIso: e.startIso,
      endIso: e.endIso,
      allDay: e.allDay,
      location: e.location ?? null,
      recurring: e.recurringEventId != null,
    }));
    google = sortHits(googleHits, nowIso);
  } catch (err) {
    googleError = err instanceof Error ? err.message : "Google search failed";
  }

  return { local, google, googleError, scope };
}
