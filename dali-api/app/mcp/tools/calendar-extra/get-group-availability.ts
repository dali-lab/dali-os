// MCP `get_group_availability` — intersect free/busy for a set of users over a
// week window. Mirrors the logic of api.calendar.group-availability.ts exactly.
// No extra role gate beyond `mcp:read`.

import {
  computeUserFreeBusy,
  intersectFreeIntervals,
  type Interval,
} from "~/lib/availability";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import { McpInvalidError } from "../../registry";

export const GET_GROUP_AVAILABILITY_DEF = {
  name: "get_group_availability",
  description:
    "Compute group availability for a set of users over a week window. Returns day-bucketed match windows and per-user free intervals.",
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
        description: "ISO 8601 end of the window (exclusive).",
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

// ─── Helpers (mirrors the web route) ─────────────────────────────────────────

function unionMany(sets: Interval[][]): Interval[] {
  const all: Interval[] = sets
    .flat()
    .sort((x, y) => x.start.getTime() - y.start.getTime());
  if (all.length === 0) return [];
  const merged: Interval[] = [{ ...all[0] }];
  for (let i = 1; i < all.length; i++) {
    const last = merged[merged.length - 1];
    if (all[i].start.getTime() <= last.end.getTime()) {
      if (all[i].end.getTime() > last.end.getTime()) last.end = all[i].end;
    } else {
      merged.push({ ...all[i] });
    }
  }
  return merged;
}

function splitByZonedDay(
  interval: Interval,
  timezone: string,
): { dayKey: string; startHour: number; durationHours: number }[] {
  const out: { dayKey: string; startHour: number; durationHours: number }[] = [];
  let cursor = interval.start;
  while (cursor.getTime() < interval.end.getTime()) {
    const ymd = getZonedYMD(cursor, timezone);
    const nextDayUtc = zonedDayStartUtc(ymd.year, ymd.month, ymd.day + 1, timezone);
    const segmentEnd =
      nextDayUtc.getTime() < interval.end.getTime() ? nextDayUtc : interval.end;
    const startHour = localHourFractional(cursor, timezone);
    const durationHours = (segmentEnd.getTime() - cursor.getTime()) / 3_600_000;
    if (durationHours > 0) {
      out.push({
        dayKey: `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`,
        startHour,
        durationHours,
      });
    }
    cursor = segmentEnd;
  }
  return out;
}

function localHourFractional(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return (get("hour") % 24) + get("minute") / 60 + get("second") / 3600;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function runGetGroupAvailability(input: Input) {
  const windowStart = new Date(input.weekStartIso);
  const windowEnd = new Date(input.weekEndIso);

  if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
    throw new McpInvalidError("weekStartIso and weekEndIso must be valid ISO 8601 dates");
  }
  if (windowEnd <= windowStart) {
    throw new McpInvalidError("weekEndIso must be after weekStartIso");
  }

  const userIds = Array.from(new Set(input.userIds));

  const perUser = await Promise.all(
    userIds.map((uid) =>
      computeUserFreeBusy(uid, windowStart, windowEnd, input.timezone),
    ),
  );

  const minDurationMs = input.durationMinutes * 60_000;
  const matches = intersectFreeIntervals(perUser.map((u) => u.free)).filter(
    (iv) => iv.end.getTime() - iv.start.getTime() >= minDurationMs,
  );

  const busyUnion = unionMany(perUser.map((u) => u.busy));

  type DayBucket = {
    dayOfWeek: number;
    dayOfMonth: number;
    matches: { startHour: number; durationHours: number }[];
    busy: { startHour: number; durationHours: number }[];
  };

  const dayMap = new Map<string, DayBucket>();
  const ensureDay = (key: string, dayOfWeek: number, dayOfMonth: number): DayBucket => {
    const existing = dayMap.get(key);
    if (existing) return existing;
    const bucket: DayBucket = { dayOfWeek, dayOfMonth, matches: [], busy: [] };
    dayMap.set(key, bucket);
    return bucket;
  };

  for (const m of matches) {
    for (const piece of splitByZonedDay(m, input.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.matches.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }
  for (const b of busyUnion) {
    for (const piece of splitByZonedDay(b, input.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.busy.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }

  const days = Array.from(dayMap.entries())
    .map(([dayKey, bucket]) => ({ dayKey, ...bucket }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  const perUserOut = perUser.map((u) => ({
    userId: u.userId,
    free: u.free.map((iv) => ({
      startIso: iv.start.toISOString(),
      endIso: iv.end.toISOString(),
    })),
  }));

  return { days, perUser: perUserOut };
}
