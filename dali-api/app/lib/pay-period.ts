// Payroll's fortnight. Hours are approved and paid per pay period, so the
// Timesheet's per-role totals accumulate across one and start over at the next.
//
// Derived from a fixed anchor rather than read from the PayPeriod table: that
// table is populated by TimesheetX CSV imports, so it only ever covers periods
// payroll has already closed and exported. The calendar needs to know which
// period *today* is in, and which boundary is coming up — both of which are
// pure arithmetic off a known start date.
//
// Anchor: 2026-07-05 begins a period (2026-07-05 → 2026-07-18), and every
// period is exactly 14 days from there, forward and backward. It falls on a
// Sunday, which is what keeps a Sun–Sat calendar week inside a single period —
// the week grid relies on that when it totals hours.

export const PAY_PERIOD_DAYS = 14;

/** UTC midnight on a day that starts a pay period. */
const ANCHOR_UTC = Date.UTC(2026, 6, 5); // 2026-07-05

const DAY_MS = 86_400_000;

export type PayPeriod = {
  /** UTC midnight of the first day, inclusive. */
  start: Date;
  /** UTC midnight of the last day, inclusive — 13 days after `start`. */
  end: Date;
  /** Periods since the anchor; negative before it. Stable id for grouping. */
  index: number;
};

/**
 * The pay period containing `dayUtc`, which must be a UTC-midnight timestamp
 * for a calendar day in the viewer's zone (see zonedDayStartUtc callers, which
 * produce real instants — pass the day's UTC midnight, not the instant).
 */
export function payPeriodFor(dayUtcMidnight: Date): PayPeriod {
  const offsetDays = Math.floor((dayUtcMidnight.getTime() - ANCHOR_UTC) / DAY_MS);
  // Math.floor on the quotient, not the remainder: dates before the anchor
  // must round down too, or the period before 2026-07-05 would be off by one.
  const index = Math.floor(offsetDays / PAY_PERIOD_DAYS);
  const startMs = ANCHOR_UTC + index * PAY_PERIOD_DAYS * DAY_MS;
  return {
    start: new Date(startMs),
    end: new Date(startMs + (PAY_PERIOD_DAYS - 1) * DAY_MS),
    index,
  };
}

/** True when this calendar day is the last of its pay period. */
export function isPayPeriodEnd(dayUtcMidnight: Date): boolean {
  return payPeriodFor(dayUtcMidnight).end.getTime() === dayUtcMidnight.getTime();
}

/** "Jul 5 – Jul 18" — the period's own label, in the viewer's zone. */
export function formatPayPeriod(period: PayPeriod, timeZone: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  void timeZone; // Boundaries are calendar dates, not instants — always UTC.
  return `${fmt(period.start)} – ${fmt(period.end)}`;
}
