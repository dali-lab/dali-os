// Pure schedule math for "Classes this term" — resolving a class's weekly
// meetings, finding the first occurrence, building the term-bounded RRULE, and
// expanding Local classes into concrete occurrences for the grid. Kept free of
// prisma/Google (only timezone + the period table) so it's unit-testable and
// safe to share with the client. Times are Dartmouth (Eastern) wall-clock.

import { getZonedYMD, zonedWallTimeUtc } from "~/lib/timezone";
import { periodMeetings, rruleByDay, type PeriodMeeting } from "./dartmouth-periods";

export const DARTMOUTH_TZ = "America/New_York";

/** Resolve a class's meetings from a period code (+ x-hour opt-in) or a custom
 *  set the caller supplies. Returns [] when nothing resolves. */
export function resolveClassMeetings(
  input: { periodCode: string; includeXHour: boolean } | { custom: PeriodMeeting[] },
): PeriodMeeting[] {
  return "custom" in input ? input.custom : periodMeetings(input.periodCode, input.includeXHour);
}

const hm = (min: number) => [Math.floor(min / 60), min % 60] as const;

/** First occurrence of a weekly meeting on/after `from`, as a {start,end} UTC
 *  range at Dartmouth wall-clock — the DTSTART for a Google recurring event. */
export function firstOccurrenceRange(
  meeting: PeriodMeeting,
  from: Date,
  tz = DARTMOUTH_TZ,
): { startIso: string; endIso: string } {
  const days = new Set(meeting.days);
  const base = getZonedYMD(from, tz);
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(base.year, base.month - 1, base.day + i));
    if (!days.has(d.getUTCDay())) continue;
    const [y, mo, da] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const [sh, sm] = hm(meeting.startMin);
    const [eh, em] = hm(meeting.endMin);
    return {
      startIso: zonedWallTimeUtc(y, mo, da, sh, sm, tz).toISOString(),
      endIso: zonedWallTimeUtc(y, mo, da, eh, em, tz).toISOString(),
    };
  }
  // Unreachable for a valid meeting (some weekday always matches within a week).
  const [sh, sm] = hm(meeting.startMin);
  const [eh, em] = hm(meeting.endMin);
  return {
    startIso: zonedWallTimeUtc(base.year, base.month, base.day, sh, sm, tz).toISOString(),
    endIso: zonedWallTimeUtc(base.year, base.month, base.day, eh, em, tz).toISOString(),
  };
}

/** RFC-5545 UNTIL (UTC basic format) for the end of the term's last day. */
function rruleUntil(termEnd: Date): string {
  const y = termEnd.getUTCFullYear();
  const m = String(termEnd.getUTCMonth() + 1).padStart(2, "0");
  const d = String(termEnd.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}T235959Z`;
}

/** Weekly RRULE for a meeting, bounded to the term end (no "RRULE:" prefix). */
export function classRRule(meeting: PeriodMeeting, termEnd: Date): string {
  return `FREQ=WEEKLY;BYDAY=${rruleByDay(meeting.days)};UNTIL=${rruleUntil(termEnd)}`;
}

export type ClassOccurrence = { startIso: string; endIso: string; kind: "main" | "xhour" };

/** Expand a Local class's meetings into concrete occurrences within
 *  [rangeStart, rangeEnd] intersected with the term, at Dartmouth wall-clock. */
export function expandClassOccurrences(
  meetings: PeriodMeeting[],
  termStart: Date,
  termEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
  tz = DARTMOUTH_TZ,
): ClassOccurrence[] {
  const lo = Math.max(termStart.getTime(), rangeStart.getTime());
  const hi = Math.min(termEnd.getTime(), rangeEnd.getTime());
  if (lo > hi) return [];
  const out: ClassOccurrence[] = [];
  const base = getZonedYMD(new Date(lo), tz);
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(base.year, base.month - 1, base.day + i));
    const [y, mo, da] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const wd = d.getUTCDay();
    if (zonedWallTimeUtc(y, mo, da, 0, 0, tz).getTime() > hi) break;
    for (const mtg of meetings) {
      if (!mtg.days.includes(wd)) continue;
      const [sh, sm] = hm(mtg.startMin);
      const [eh, em] = hm(mtg.endMin);
      const s = zonedWallTimeUtc(y, mo, da, sh, sm, tz);
      if (s.getTime() < lo || s.getTime() > hi) continue;
      out.push({
        startIso: s.toISOString(),
        endIso: zonedWallTimeUtc(y, mo, da, eh, em, tz).toISOString(),
        kind: mtg.kind,
      });
    }
  }
  return out;
}
