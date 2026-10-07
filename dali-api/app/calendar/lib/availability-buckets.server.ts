// Shared day-bucketing for the mutual-availability endpoints: turns a set of
// per-user free/busy interval lists into the { dayKey, matches, busy } rows
// ScheduleWeekGrid and the partner portal's aggregate view both consume.
// Extracted from api.calendar.group-availability so the partner-portal
// endpoint (/api/partner/availability, which must never return a per-user
// breakdown) can build the identical aggregate shape without duplicating it.

import type { Interval } from "~/lib/availability";
import { intersectFreeIntervals } from "~/lib/availability";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import type { GroupAvailDay } from "~/calendar/lib/types";

export type UserFreeBusy = { free: Interval[]; busy: Interval[] };

export function unionIntervals(sets: Interval[][]): Interval[] {
  const all: Interval[] = sets.flat().sort((x, y) => x.start.getTime() - y.start.getTime());
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

function localHourFractional(d: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return (get("hour") % 24) + get("minute") / 60 + get("second") / 3600;
}

// Split an interval at zoned midnight boundaries so each piece lives on a single
// calendar day in `timezone`, then emit { dayKey, startHour, durationHours }
// rows that the WeekGrid can render directly.
function splitByZonedDay(
  interval: Interval,
  timezone: string,
): { dayKey: string; startHour: number; durationHours: number }[] {
  const out: { dayKey: string; startHour: number; durationHours: number }[] = [];
  let cursor = interval.start;
  while (cursor.getTime() < interval.end.getTime()) {
    const ymd = getZonedYMD(cursor, timezone);
    const nextDayUtc = zonedDayStartUtc(ymd.year, ymd.month, ymd.day + 1, timezone);
    const segmentEnd = nextDayUtc.getTime() < interval.end.getTime() ? nextDayUtc : interval.end;
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

/**
 * Intersect every user's free intervals (≥ durationMinutes) and union every
 * user's busy intervals, then bucket both by calendar day in `timezone`. The
 * caller decides what to do with per-user data — this never sees user ids.
 */
export function buildAvailabilityDays(
  perUser: UserFreeBusy[],
  opts: { durationMinutes: number; timezone: string },
): GroupAvailDay[] {
  const minDurationMs = opts.durationMinutes * 60_000;
  const matches = intersectFreeIntervals(perUser.map((u) => u.free)).filter(
    (iv) => iv.end.getTime() - iv.start.getTime() >= minDurationMs,
  );
  const busyUnion = unionIntervals(perUser.map((u) => u.busy));

  const dayMap = new Map<string, GroupAvailDay>();
  const ensureDay = (key: string, dayOfWeek: number, dayOfMonth: number): GroupAvailDay => {
    const existing = dayMap.get(key);
    if (existing) return existing;
    const bucket: GroupAvailDay = { dayKey: key, dayOfWeek, dayOfMonth, matches: [], busy: [] };
    dayMap.set(key, bucket);
    return bucket;
  };

  for (const m of matches) {
    for (const piece of splitByZonedDay(m, opts.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.matches.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }
  for (const b of busyUnion) {
    for (const piece of splitByZonedDay(b, opts.timezone)) {
      const ymd = piece.dayKey.split("-").map(Number);
      const localDate = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
      const bucket = ensureDay(piece.dayKey, localDate.getUTCDay(), ymd[2]);
      bucket.busy.push({ startHour: piece.startHour, durationHours: piece.durationHours });
    }
  }

  return Array.from(dayMap.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}
