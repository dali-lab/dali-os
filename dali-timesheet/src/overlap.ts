// Time-range comparison for deciding whether a pulled entry collides with what
// JobX already has saved.
//
// Split out of jobx.ts because it's the only genuinely tricky logic in the
// extension and it touches people's paid hours: getting it wrong either drops
// real time (an overwrite that shouldn't happen) or double-logs it. Everything
// here is pure, so it can be tested without a DOM.

/** Minutes since midnight for a "h:mm am/pm" label. Null when unparseable. */
export function parseClockLabel(label: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(label);
  if (!m) return null;
  const h12 = Number(m[1]);
  const min = Number(m[2]);
  if (h12 < 1 || h12 > 12 || min > 59) return null;
  // 12am → 0, 12pm → 12, 1pm → 13.
  const h24 = (h12 % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
  return h24 * 60 + min;
}

/**
 * The first two times in a saved row's text, as a [start, end] minute range.
 * Null when the row doesn't state a range we can read — callers treat that as
 * ambiguous rather than assuming no conflict.
 */
export function savedRowRange(text: string): [number, number] | null {
  const matches = text.match(/\d{1,2}:\d{2}\s*(?:am|pm)/gi);
  if (!matches || matches.length < 2) return null;
  const start = parseClockLabel(matches[0]!);
  const end = parseClockLabel(matches[1]!);
  if (start === null || end === null) return null;
  return [start, end];
}

/**
 * Half-open overlap: a block ending at 11:00 and one starting at 11:00 are
 * back-to-back sessions, not a collision. Getting this wrong would make every
 * adjacent pair look like an override.
 */
export function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * Does this entry's range collide with anything already saved on the day?
 * An unreadable saved row counts as a collision: silently adding a possible
 * duplicate to a timesheet is worse than asking the member to look.
 */
export function conflictsWithSaved(
  entry: [number, number],
  savedRowTexts: string[],
): boolean {
  return savedRowTexts.some((text) => {
    const range = savedRowRange(text);
    return range === null || overlaps(entry, range);
  });
}

/** Total hours across a set of [start, end] minute ranges. */
export function totalHours(ranges: [number, number][]): number {
  const minutes = ranges.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0);
  return minutes / 60;
}

/** "7h 30m" / "8h" / "45m" — compact enough for a panel header. */
export function formatHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
