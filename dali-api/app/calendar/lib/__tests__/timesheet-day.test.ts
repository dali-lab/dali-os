import { describe, it, expect } from "vitest";
import { timeEntryDayUtc } from "~/calendar/lib/timesheet-day";
import { payPeriodFor } from "~/lib/pay-period";

const ET = "America/New_York";

// 2026-07-05 (a Sunday) opens a pay period; 2026-07-18 closes it.
const PERIOD_INDEX = payPeriodFor(new Date(Date.UTC(2026, 6, 5))).index;

describe("timeEntryDayUtc", () => {
  it("keeps a date-only entry on the day that was picked", () => {
    // The add form posts "2026-07-05", stored as UTC midnight. Read as an
    // instant that is Jul 4 in ET — the bug this guards.
    const day = timeEntryDayUtc({ date: "2026-07-05T00:00:00.000Z", startTime: null }, ET);
    expect(day.toISOString()).toBe("2026-07-05T00:00:00.000Z");
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX);
  });

  it("uses the local day a timed entry starts on", () => {
    // 10am ET on Jul 5.
    const day = timeEntryDayUtc(
      { date: "2026-07-05T14:00:00.000Z", startTime: "2026-07-05T14:00:00.000Z" },
      ET,
    );
    expect(day.toISOString()).toBe("2026-07-05T00:00:00.000Z");
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX);
  });

  it("puts a late-evening entry on its local day, not the UTC one", () => {
    // 8pm ET on Jul 4 is already Jul 5 in UTC — it belongs to the previous
    // period, and reading the raw UTC date would pull it into this one.
    const day = timeEntryDayUtc(
      { date: "2026-07-05T00:00:00.000Z", startTime: "2026-07-05T00:00:00.000Z" },
      ET,
    );
    expect(day.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX - 1);
  });

  it("keeps the closing Saturday inside the period", () => {
    const day = timeEntryDayUtc({ date: "2026-07-18T00:00:00.000Z", startTime: null }, ET);
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX);
  });

  it("puts the next day into the next period", () => {
    const day = timeEntryDayUtc({ date: "2026-07-19T00:00:00.000Z", startTime: null }, ET);
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX + 1);
  });

  it("resolves the local day east of UTC too", () => {
    // 7am Tokyo on Jul 19 is 2026-07-18T22:00Z — still Jul 18 in UTC, so the
    // raw instant would hold it in the closing period it no longer belongs to.
    const day = timeEntryDayUtc(
      { date: "2026-07-18T22:00:00.000Z", startTime: "2026-07-18T22:00:00.000Z" },
      "Asia/Tokyo",
    );
    expect(day.toISOString()).toBe("2026-07-19T00:00:00.000Z");
    expect(payPeriodFor(day).index).toBe(PERIOD_INDEX + 1);
  });
});
