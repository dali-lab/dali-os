import { computeUserFreeBusy, intersectFreeIntervals } from "~/calendar/lib/availability.server";
import { buildAvailabilityDays } from "~/calendar/lib/availability-buckets.server";
import type { EventReadReport } from "~/calendar/lib/google-calendar.server";
import { APPLICATION_TZ } from "~/lib/timezone";
import { McpInvalidError } from "../../errors";

export const FIND_FREE_TIMES_DEF = {
  name: "find_free_times",
  description:
    "Find when people are free over a window of up to 14 days. The caller is always included; userIds adds others (up to 50), so omitting it reads only the caller's own calendar. detail slots (default) lists the times everyone is free for at least durationMinutes. detail full returns day-bucketed match, busy and shared working-hours windows plus each person's free, busy and working intervals. Free outside someone's working intervals means outside working hours, not busy. hasCalendar false or calendarError true means free is a working-hours default, not confirmed free. truncated true means a calendar had more than 2,500 events, so busy may be missing some.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 50,
        description: "Other users to include. The caller is added automatically.",
      },
      start: { type: "string", minLength: 1, description: "ISO 8601 window start (inclusive)." },
      end: { type: "string", minLength: 1, description: "ISO 8601 window end (exclusive). At most 14 days after start." },
      durationMinutes: {
        type: "integer",
        minimum: 5,
        maximum: 480,
        description: "Minimum free length in minutes. Default 30.",
      },
      timezone: {
        type: "string",
        minLength: 1,
        description: "IANA timezone for day bucketing and for people with no zone set. Default is the lab's zone.",
      },
      detail: {
        type: "string",
        enum: ["slots", "full"],
        description: "slots: mutual free slots only (default). full: day buckets and per-user intervals.",
      },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  userIds?: string[];
  start: string;
  end: string;
  durationMinutes?: number;
  timezone?: string;
  detail?: "slots" | "full";
};

const MAX_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_MINUTES = 30;

const toIso = (iv: { start: Date; end: Date }) => ({
  startIso: iv.start.toISOString(),
  endIso: iv.end.toISOString(),
});

export async function runFindFreeTimes(callerId: string, input: Input) {
  const windowStart = new Date(input.start);
  const windowEnd = new Date(input.end);
  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new McpInvalidError("start and end must be valid ISO 8601 dates");
  }
  if (windowEnd <= windowStart) throw new McpInvalidError("end must be after start");
  if (windowEnd.getTime() - windowStart.getTime() > MAX_SPAN_MS) {
    throw new McpInvalidError("Window span must be ≤ 14 days");
  }

  const timezone = input.timezone ?? APPLICATION_TZ;
  const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const userIds = Array.from(new Set([callerId, ...(input.userIds ?? [])]));
  const report: EventReadReport = { truncated: false };

  const perUser = await Promise.all(
    userIds.map((uid) => computeUserFreeBusy(uid, windowStart, windowEnd, timezone, report)),
  );

  if (input.detail === "full") {
    const days = buildAvailabilityDays(perUser, { durationMinutes, timezone });
    return {
      days,
      perUser: perUser.map((u) => ({
        userId: u.userId,
        free: u.free.map(toIso),
        busy: u.busy.map(toIso),
        working: u.working.map(toIso),
        hasCalendar: u.hasCalendar,
        calendarError: u.calendarError,
      })),
      truncated: report.truncated,
    };
  }

  const minMs = durationMinutes * 60_000;
  const slots = intersectFreeIntervals(perUser.map((u) => u.free)).filter(
    (iv) => iv.end.getTime() - iv.start.getTime() >= minMs,
  );
  return {
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    truncated: report.truncated,
  };
}
