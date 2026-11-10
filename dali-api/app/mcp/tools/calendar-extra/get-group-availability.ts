// MCP `get_group_availability` — intersect free/busy for a set of users over a
// week window. Same output as api.calendar.group-availability.ts.
// No extra role gate beyond `mcp:read`.

import { computeUserFreeBusy } from "~/lib/availability";
import { buildAvailabilityDays } from "~/calendar/lib/availability-buckets.server";
import { McpInvalidError } from "../../registry";

export const GET_GROUP_AVAILABILITY_DEF = {
  name: "get_group_availability",
  description:
    "Compute group availability for a set of users over a window of up to 14 days. Returns day-bucketed match windows, busy blocks, and shared working hours, plus per-user free and working-hours intervals. A user who isn't free during a slot that falls outside their working intervals is outside their working hours, not busy.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 50,
        description: "User IDs to include (1–50).",
      },
      weekStartIso: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 start of the window (inclusive).",
      },
      weekEndIso: {
        type: "string",
        minLength: 1,
        description: "ISO 8601 end of the window (exclusive). Span must be at most 14 days.",
      },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Minimum match duration in minutes.",
      },
      timezone: {
        type: "string",
        minLength: 1,
        description: "IANA timezone for day bucketing (e.g. America/New_York).",
      },
    },
    required: ["userIds", "weekStartIso", "weekEndIso", "durationMinutes", "timezone"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  userIds: string[];
  weekStartIso: string;
  weekEndIso: string;
  durationMinutes: number;
  timezone: string;
};

// ─── Handler ──────────────────────────────────────────────────────────────────

const MAX_SPAN_MS = 14 * 24 * 60 * 60 * 1000;

export async function runGetGroupAvailability(input: Input) {
  const windowStart = new Date(input.weekStartIso);
  const windowEnd = new Date(input.weekEndIso);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new McpInvalidError("weekStartIso and weekEndIso must be valid ISO 8601 dates");
  }
  if (windowEnd <= windowStart) {
    throw new McpInvalidError("weekEndIso must be after weekStartIso");
  }
  if (windowEnd.getTime() - windowStart.getTime() > MAX_SPAN_MS) {
    throw new McpInvalidError("Window span must be ≤ 14 days");
  }

  const userIds = Array.from(new Set(input.userIds));

  const perUser = await Promise.all(
    userIds.map((uid) =>
      computeUserFreeBusy(uid, windowStart, windowEnd, input.timezone),
    ),
  );

  const days = buildAvailabilityDays(perUser, {
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
  });

  const toIso = (iv: { start: Date; end: Date }) => ({
    startIso: iv.start.toISOString(),
    endIso: iv.end.toISOString(),
  });
  const perUserOut = perUser.map((u) => ({
    userId: u.userId,
    free: u.free.map(toIso),
    working: u.working.map(toIso),
    // Coverage: false when the user has no linked calendar (or a failed sync).
    // `free` is then a working-hours default, not confirmed availability — do
    // not treat these users as free.
    hasCalendar: u.hasCalendar,
    calendarError: u.calendarError,
  }));

  return { days, perUser: perUserOut };
}
