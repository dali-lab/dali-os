import { getZonedParts, zonedDayStartUtc } from "~/lib/timezone";

// JobX rows are one calendar day each, and it counts a row's end minute as
// worked: Role A 1:00-2:00 and Role B 2:00-3:00 overlap at 2:00 across the two
// timesheets, and JobX refuses the second save.

export type JobxRow = {
  /** The hire the row is filed under (roleRefId or "unassigned"). */
  hireKey: string;
  date: string;
  /** Minutes since local midnight. */
  startMin: number;
  endMin: number;
  hours: number;
  description: string;
};

const LAST_MINUTE = 24 * 60 - 1;
const pad2 = (n: number) => String(n).padStart(2, "0");

export const clockTime = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

function wallClock(d: Date, timezone: string) {
  const z = getZonedParts(d, timezone);
  return { date: `${z.year}-${pad2(z.month)}-${pad2(z.day)}`, y: z.year, m: z.month, d: z.day, min: z.hour * 60 + z.minute };
}

/**
 * One row per local day the entry touches. A day the entry runs through to
 * midnight ends at 23:59, and the next day's row picks up at 00:00. Hours
 * are shared out by each day's share of the entry's length.
 */
export function splitAtMidnight(
  entry: { hireKey: string; start: Date; end: Date; hours: number; description: string },
  timezone: string,
): JobxRow[] {
  const { hireKey, start, end, hours, description } = entry;
  const totalMs = end.getTime() - start.getTime();
  const rows: JobxRow[] = [];
  let cursor = start;
  while (cursor < end) {
    const here = wallClock(cursor, timezone);
    const tomorrow = new Date(Date.UTC(here.y, here.m - 1, here.d + 1));
    const nextMidnight = zonedDayStartUtc(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      timezone,
    );
    const segEnd = end < nextMidnight ? end : nextMidnight;
    rows.push({
      hireKey,
      date: here.date,
      startMin: here.min,
      endMin: segEnd === end ? wallClock(end, timezone).min : LAST_MINUTE,
      hours: totalMs > 0 ? Math.round(((hours * (segEnd.getTime() - cursor.getTime())) / totalMs) * 100) / 100 : hours,
      description,
    });
    cursor = segEnd;
  }
  if (rows.length === 0) {
    const here = wallClock(start, timezone);
    rows.push({ hireKey, date: here.date, startMin: here.min, endMin: here.min, hours, description });
  }
  return rows;
}

/**
 * Moves a row that starts the minute another hire's row ends one minute
 * later. Its end moves too, keeping its length, unless something already
 * starts there or it would leave the day, in which case only the start moves.
 */
export function offsetHireHandoffs(rows: JobxRow[]): JobxRow[] {
  const out = rows.map((r) => ({ ...r }));
  const byDay = new Map<string, JobxRow[]>();
  for (const r of out) {
    const day = byDay.get(r.date) ?? [];
    day.push(r);
    byDay.set(r.date, day);
  }
  for (const day of byDay.values()) {
    day.sort((a, b) => a.startMin - b.startMin);
    for (const row of day) {
      if (row.endMin <= row.startMin) continue;
      const handoff = day.some((o) => o !== row && o.hireKey !== row.hireKey && o.endMin === row.startMin);
      if (!handoff) continue;
      const endTaken = row.endMin >= LAST_MINUTE || day.some((o) => o !== row && o.startMin === row.endMin);
      row.startMin += 1;
      if (!endTaken) row.endMin += 1;
    }
  }
  return out;
}
