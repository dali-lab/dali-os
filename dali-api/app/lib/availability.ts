import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
import { prisma } from "~/lib/db";
import { fetchBusyEvents } from "~/lib/google-calendar";
import { APPLICATION_TZ as DEFAULT_TIMEZONE, getZonedYMD, pickUserTimezone, zonedDayStartUtc } from "~/lib/timezone";

const { RRule, rrulestr } = rrulePkg as unknown as {
  RRule: typeof import("rrule").RRule;
  rrulestr: typeof import("rrule").rrulestr;
};

export interface Interval {
  start: Date;
  end: Date;
}

export interface WorkingHoursDayInput {
  dayOfWeek: number; // 0=Sun..6=Sat
  enabled: boolean;
  startMinute: number;
  endMinute: number;
}

export interface ComputeInput {
  windowStart: Date;
  windowEnd: Date;
  workingHours: WorkingHoursDayInput[];
  externalBusy: Interval[];
  bufferMin: number;
  timezone: string;
}

export interface ComputeOutput {
  free: Interval[];
  busy: Interval[];
}

/**
 * Build the user's available intervals across [windowStart, windowEnd].
 *
 * Steps:
 *   1. Project enabled working-hours days onto the calendar dates in the
 *      window (in the user's timezone — DST-correct).
 *   2. Combine externalBusy into a busy set, inflate each busy interval by
 *      bufferMin minutes on both sides, and merge overlaps.
 *   3. Subtract the (inflated, merged) busy set from the working-hours
 *      intervals. The remainder is `free`; the merged busy set is returned
 *      as `busy`.
 */
export function computeFreeIntervals(input: ComputeInput): ComputeOutput {
  const { windowStart, windowEnd, workingHours, externalBusy, bufferMin, timezone } = input;

  if (windowEnd.getTime() <= windowStart.getTime()) {
    return { free: [], busy: [] };
  }

  // Multiple segments per day-of-week are allowed (e.g. 07:00–09:00 Remote and
  // 09:00–12:00 InPerson on the same Monday).
  const whByDow = new Map<number, WorkingHoursDayInput[]>();
  for (const d of workingHours) {
    const list = whByDow.get(d.dayOfWeek);
    if (list) list.push(d);
    else whByDow.set(d.dayOfWeek, [d]);
  }

  // (1) Project working hours.
  const workIntervals: Interval[] = [];
  const startYmd = getZonedYMD(windowStart, timezone);
  const endYmd = getZonedYMD(windowEnd, timezone);
  // Iterate UTC-anchored midnights for each calendar day in the window's zone.
  let cursor = new Date(Date.UTC(startYmd.year, startYmd.month - 1, startYmd.day));
  const lastUtc = new Date(Date.UTC(endYmd.year, endYmd.month - 1, endYmd.day));
  while (cursor.getTime() <= lastUtc.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const dayStartUtc = zonedDayStartUtc(y, m, d, timezone);
    // Day-of-week is computed from the local date, not the UTC instant.
    const dow = dowFromYmd(y, m, d);
    const segments = whByDow.get(dow);
    if (segments) {
      for (const wh of segments) {
        if (!wh.enabled || wh.startMinute >= wh.endMinute) continue;
        const wStart = new Date(dayStartUtc.getTime() + wh.startMinute * 60_000);
        const wEnd = new Date(dayStartUtc.getTime() + wh.endMinute * 60_000);
        const clipped = clipToWindow(wStart, wEnd, windowStart, windowEnd);
        if (clipped) workIntervals.push(clipped);
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000);
  }

  // (2) Build merged busy set with buffer.
  const bufferMs = Math.max(0, bufferMin) * 60_000;
  const rawBusy: Interval[] = [];
  for (const i of externalBusy) {
    rawBusy.push({ start: new Date(i.start.getTime() - bufferMs), end: new Date(i.end.getTime() + bufferMs) });
  }
  const mergedBusy = mergeIntervals(rawBusy);

  // Merge adjacent/overlapping working-hours segments before subtraction so
  // multiple segments on the same day collapse to a single union.
  const mergedWork = mergeIntervals(workIntervals);

  // (4) Subtract busy from working hours.
  const free = subtractIntervals(mergedWork, mergedBusy);
  return { free, busy: mergedBusy };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function dowFromYmd(year: number, month: number, day: number): number {
  // Zeller-free: use UTC Date. Same calendar date → same weekday regardless of tz.
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function clipToWindow(s: Date, e: Date, windowStart: Date, windowEnd: Date): Interval | null {
  const start = s.getTime() < windowStart.getTime() ? windowStart : s;
  const end = e.getTime() > windowEnd.getTime() ? windowEnd : e;
  if (end.getTime() <= start.getTime()) return null;
  return { start, end };
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

function subtractIntervals(base: Interval[], remove: Interval[]): Interval[] {
  if (base.length === 0) return [];
  if (remove.length === 0) return [...base];
  const sortedRemove = mergeIntervals(remove);
  const out: Interval[] = [];
  for (const b of base) {
    let segments: Interval[] = [{ start: b.start, end: b.end }];
    for (const r of sortedRemove) {
      const next: Interval[] = [];
      for (const seg of segments) {
        if (r.end.getTime() <= seg.start.getTime() || r.start.getTime() >= seg.end.getTime()) {
          next.push(seg);
          continue;
        }
        if (r.start.getTime() > seg.start.getTime()) {
          next.push({ start: seg.start, end: r.start });
        }
        if (r.end.getTime() < seg.end.getTime()) {
          next.push({ start: r.end, end: seg.end });
        }
      }
      segments = next;
      if (segments.length === 0) break;
    }
    out.push(...segments);
  }
  return out;
}

function buildRule(rule: string, dtstart: Date): RRuleType | null {
  try {
    const trimmed = rule.trim();
    // Accept both "FREQ=…" and full "RRULE:FREQ=…" forms.
    const rrulePart = trimmed.toUpperCase().startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`;
    // rrulestr handles a string with DTSTART when joined.
    const composed = `DTSTART:${formatDtstart(dtstart)}\n${rrulePart}`;
    const parsed = rrulestr(composed);
    if (parsed instanceof RRule) return parsed;
    // RRuleSet handling not needed at this layer; fall through.
    return null;
  } catch {
    return null;
  }
}

function formatDtstart(d: Date): string {
  // Floating local-time format would require a TZID block; using UTC keeps it
  // simple and matches how we store recurring blocks (DTSTART = startTime in UTC).
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// ─── Multi-user mutual-availability helpers ─────────────────────────────────
//
// These power the in-app meeting scheduler (api.calendar.group-availability)
// and the MCP `find_mutual_freebusy` tool. The route still owns its own
// per-day grid bucketing; this module owns the cross-user math.

const DEFAULT_BUFFER_MIN = 15;

/**
 * Load + compute free/busy for a single user across the given window.
 * Pulls UserAvailabilitySettings, WorkingHoursDay segments, ManualBlock rows
 * (incl. RRULE expansion), and external Google Calendar busy events.
 *
 * `fallbackTimezone` is used only if the user has no UserAvailabilitySettings row.
 */
export async function computeUserFreeBusy(
  userId: string,
  windowStart: Date,
  windowEnd: Date,
  fallbackTimezone: string = DEFAULT_TIMEZONE,
): Promise<{ userId: string; free: Interval[]; busy: Interval[] }> {
  const [settings, userRow, whRows, busyRaw] = await Promise.all([
    prisma.userAvailabilitySettings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
    prisma.workingHoursDay.findMany({ where: { userId } }),
    fetchBusyEvents(userId, windowStart, windowEnd).catch(
      () => [] as { start: string; end: string }[],
    ),
  ]);

  // Working-hours policy:
  //   • No persisted rows at all  → feature is OFF → the user is available
  //     all day, every day (a single 00:00–24:00 "working" segment per dow).
  //     Free time is then simply "anything not busy".
  //   • Any persisted rows         → feature is ON → trust the saved segments
  //     verbatim (including enabled weekend days). Days the user never saved a
  //     row for stay unavailable, matching what they see in the editor.
  // Prefer the availability-settings zone (working hours depend on it); with no
  // settings row, use the user's own display zone before the caller's fallback.
  const timezone = pickUserTimezone(settings?.timezone, userRow?.timeZone, fallbackTimezone);
  const hasPersisted = whRows.length > 0;
  const workingHours: WorkingHoursDayInput[] = hasPersisted
    ? whRows.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        enabled: r.enabled,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
      }))
    : Array.from({ length: 7 }).map((_, dow) => ({
        dayOfWeek: dow,
        enabled: true,
        startMinute: 0,
        endMinute: 24 * 60,
      }));

  const externalBusy: Interval[] = busyRaw.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));

  const { free, busy } = computeFreeIntervals({
    windowStart,
    windowEnd,
    workingHours,
    externalBusy,
    bufferMin: settings?.defaultEventBufferMin ?? DEFAULT_BUFFER_MIN,
    timezone,
  });
  return { userId, free, busy };
}

/**
 * Intersect a set of per-user free interval lists. Returns intervals where
 * every participant is free. Each input list must be sorted by start.
 */
export function intersectFreeIntervals(sets: Interval[][]): Interval[] {
  if (sets.length === 0) return [];
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    acc = intersectTwo(acc, sets[i]);
    if (acc.length === 0) return [];
  }
  return acc;
}

function intersectTwo(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start.getTime(), b[j].start.getTime());
    const end = Math.min(a[i].end.getTime(), b[j].end.getTime());
    if (start < end) out.push({ start: new Date(start), end: new Date(end) });
    if (a[i].end.getTime() < b[j].end.getTime()) i++;
    else j++;
  }
  return out;
}

/**
 * For a list of users, find every contiguous slot of at least `slotMinutes`
 * where all participants are mutually free.
 */
export async function findMutualFreeSlots(
  participantUserIds: string[],
  windowStart: Date,
  windowEnd: Date,
  slotMinutes: number,
): Promise<Interval[]> {
  if (participantUserIds.length === 0) return [];
  const uniq = Array.from(new Set(participantUserIds));
  const perUser = await Promise.all(
    uniq.map((uid) => computeUserFreeBusy(uid, windowStart, windowEnd)),
  );
  const minMs = Math.max(1, slotMinutes) * 60_000;
  return intersectFreeIntervals(perUser.map((u) => u.free)).filter(
    (iv) => iv.end.getTime() - iv.start.getTime() >= minMs,
  );
}
