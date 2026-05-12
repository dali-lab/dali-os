import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";

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

export interface ManualBlockInput {
  startTime: Date;
  endTime: Date;
  // RFC 5545 RRULE string (with or without "RRULE:" prefix). Null for one-off.
  recurrenceRule: string | null;
}

export interface ComputeInput {
  windowStart: Date;
  windowEnd: Date;
  workingHours: WorkingHoursDayInput[];
  manualBlocks: ManualBlockInput[];
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
 *   2. Expand each manual block (single occurrence or RRULE) to concrete
 *      intervals overlapping the window.
 *   3. Combine those expansions with externalBusy into a busy set, then
 *      inflate each busy interval by bufferMin minutes on both sides, and
 *      merge overlaps.
 *   4. Subtract the (inflated, merged) busy set from the working-hours
 *      intervals. The remainder is `free`; the merged busy set is returned
 *      as `busy`.
 */
export function computeFreeIntervals(input: ComputeInput): ComputeOutput {
  const { windowStart, windowEnd, workingHours, manualBlocks, externalBusy, bufferMin, timezone } = input;

  if (windowEnd.getTime() <= windowStart.getTime()) {
    return { free: [], busy: [] };
  }

  const whByDow = new Map<number, WorkingHoursDayInput>();
  for (const d of workingHours) whByDow.set(d.dayOfWeek, d);

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
    const wh = whByDow.get(dow);
    if (wh && wh.enabled && wh.startMinute < wh.endMinute) {
      const wStart = new Date(dayStartUtc.getTime() + wh.startMinute * 60_000);
      const wEnd = new Date(dayStartUtc.getTime() + wh.endMinute * 60_000);
      const clipped = clipToWindow(wStart, wEnd, windowStart, windowEnd);
      if (clipped) workIntervals.push(clipped);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000);
  }

  // (2) Expand manual blocks.
  const expandedManual: Interval[] = [];
  for (const b of manualBlocks) {
    const durMs = b.endTime.getTime() - b.startTime.getTime();
    if (durMs <= 0) continue;
    if (!b.recurrenceRule) {
      const c = clipToWindow(b.startTime, b.endTime, windowStart, windowEnd);
      if (c) expandedManual.push(c);
      continue;
    }
    // rrule expects a DTSTART; build a rule anchored to the block's startTime.
    const rule = buildRule(b.recurrenceRule, b.startTime);
    if (!rule) continue;
    // between(after, before, inc) — pad the window by the block duration so
    // an occurrence that *starts* before windowStart but *ends* inside it is
    // still included.
    const occurrences = rule.between(
      new Date(windowStart.getTime() - durMs),
      windowEnd,
      true,
    );
    for (const occStart of occurrences) {
      const occEnd = new Date(occStart.getTime() + durMs);
      const c = clipToWindow(occStart, occEnd, windowStart, windowEnd);
      if (c) expandedManual.push(c);
    }
  }

  // (3) Build merged busy set with buffer.
  const bufferMs = Math.max(0, bufferMin) * 60_000;
  const rawBusy: Interval[] = [];
  for (const i of expandedManual) {
    rawBusy.push({ start: new Date(i.start.getTime() - bufferMs), end: new Date(i.end.getTime() + bufferMs) });
  }
  for (const i of externalBusy) {
    rawBusy.push({ start: new Date(i.start.getTime() - bufferMs), end: new Date(i.end.getTime() + bufferMs) });
  }
  const mergedBusy = mergeIntervals(rawBusy);

  // (4) Subtract busy from working hours.
  const free = subtractIntervals(workIntervals, mergedBusy);
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
