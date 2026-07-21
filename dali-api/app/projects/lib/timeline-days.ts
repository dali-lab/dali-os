// Pure UTC-day math for the epics timeline.
//
// Epic/sprint dates are stored as UTC-midnight instants (date-only inputs
// serialized via toISOString), and the timeline's printed labels use the UTC
// calendar date. Bar geometry must therefore bucket instants into UTC days
// too — a local startOfDay() shifts bars a day early for viewers west of
// UTC while the labels stay put.

export const DAY = 86_400_000;

/** UTC midnight (ms) of the UTC calendar day containing the instant. */
export function utcDayStart(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

/** UTC midnight (ms) of the ISO instant's UTC calendar day. */
export function utcDayOf(iso: string): number {
  return utcDayStart(Date.parse(iso));
}

/**
 * The viewer's local calendar date, keyed as a UTC midnight — this is the
 * day column the "today" marker should sit on. (Plain utcDayStart(now)
 * would mark tomorrow's column for US evenings.)
 */
export function localTodayUtcDay(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Day-column offset of `iso` from a UTC-midnight range start. */
export function dayOffset(iso: string, rangeStartUtc: number): number {
  return (utcDayOf(iso) - rangeStartUtc) / DAY;
}

/** Inclusive width in days of the [startIso, endIso] span. */
export function daySpan(startIso: string, endIso: string): number {
  return (utcDayOf(endIso) - utcDayOf(startIso)) / DAY + 1;
}
