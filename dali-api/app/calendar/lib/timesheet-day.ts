// Which calendar day a TimeEntry belongs to, for grouping (pay-period totals).
//
// TimeEntry.date holds two different things depending on how the row was
// written, and they can't be read the same way:
//
//   - Meeting-sourced rows store `date: startTime` — a real instant.
//   - Rows from the Timesheet's add form store the picked "YYYY-MM-DD" parsed
//     as UTC midnight — a date-only value that is NOT the instant work started.
//
// Reading a date-only value as an instant lands a day early anywhere west of
// UTC (America/New_York, the app default): 2026-07-05T00:00Z is Jul 4, 8pm in
// New York. Pay periods start on a Sunday, so that shift moved the opening
// Sunday's hours into the previous period — they showed as blocks on the week
// grid but went missing from the per-role totals underneath it.
//
// So: prefer `startTime`, which is unambiguously an instant and is set on
// every entry the grid can draw, and fall back to reading `date` with the UTC
// getters — the same date-only reading nominalDayRange uses for untimed rows.

import { getZonedYMD } from "~/lib/timezone";
import { payPeriodFor } from "~/lib/pay-period";
import type { TimesheetHoursScope } from "~/calendar/lib/types";

const DAY_MS = 86_400_000;

export type TimesheetDayEntry = {
  /** ISO instant (meeting/block rows) or UTC midnight of a picked day (form rows). */
  date: string;
  /** ISO instant. Null for entries logged as date + hours with no time of day. */
  startTime?: string | null;
};

/**
 * UTC midnight of the entry's calendar day in `timezone` — the shape
 * payPeriodFor expects.
 */
export function timeEntryDayUtc(entry: TimesheetDayEntry, timezone: string): Date {
  if (entry.startTime) {
    const { year, month, day } = getZonedYMD(new Date(entry.startTime), timezone);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const d = new Date(entry.date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Inclusive UTC-midnight bounds of the Sun–Sat week that `weekStartIso` opens.
 *
 * `weekStartIso` is an instant — local midnight on the Sunday — so it is read
 * back through the viewer's zone rather than with the UTC getters. East of UTC
 * that instant falls on the Saturday in UTC terms, which would slide the whole
 * week a day early and, at a pay-period boundary, drop the opening Sunday's
 * hours into the period before it.
 */
export function timesheetWeekBounds(
  weekStartIso: string,
  timezone: string,
): { startDayUtc: Date; endDayUtc: Date } {
  const { year, month, day } = getZonedYMD(new Date(weekStartIso), timezone);
  const startDayUtc = new Date(Date.UTC(year, month - 1, day));
  return { startDayUtc, endDayUtc: new Date(startDayUtc.getTime() + 6 * DAY_MS) };
}

/**
 * The entries the Timesheet rail totals: those falling in the visible week, or
 * in the whole pay period that week belongs to.
 */
export function entriesInHoursScope<T extends TimesheetDayEntry>(
  entries: T[],
  scope: TimesheetHoursScope,
  weekStartIso: string,
  timezone: string,
): T[] {
  const { startDayUtc, endDayUtc } = timesheetWeekBounds(weekStartIso, timezone);
  const periodIndex = payPeriodFor(startDayUtc).index;
  return entries.filter((entry) => {
    const dayUtc = timeEntryDayUtc(entry, timezone);
    return scope === "week"
      ? dayUtc >= startDayUtc && dayUtc <= endDayUtc
      : payPeriodFor(dayUtc).index === periodIndex;
  });
}
