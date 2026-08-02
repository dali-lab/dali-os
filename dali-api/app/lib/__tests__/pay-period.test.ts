import { describe, it, expect } from "vitest";
import { payPeriodFor, isPayPeriodEnd, formatPayPeriod } from "~/lib/pay-period";

const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("payPeriodFor", () => {
  // The three periods payroll published, used as the fixture for the whole
  // schedule — if the anchor drifts, these break first.
  it.each([
    ["2026-07-05", "2026-07-05", "2026-07-18"],
    ["2026-07-18", "2026-07-05", "2026-07-18"],
    ["2026-07-19", "2026-07-19", "2026-08-01"],
    ["2026-08-01", "2026-07-19", "2026-08-01"],
    ["2026-08-02", "2026-08-02", "2026-08-15"],
    ["2026-08-15", "2026-08-02", "2026-08-15"],
  ])("%s falls in %s – %s", (target, start, end) => {
    const [y, m, d] = target.split("-").map(Number);
    const p = payPeriodFor(day(y!, m!, d!));
    expect(iso(p.start)).toBe(start);
    expect(iso(p.end)).toBe(end);
  });

  it("keeps a Sun–Sat week inside one period, both weeks of the fortnight", () => {
    // 2026-07-05 and 2026-07-12 are both Sundays in the same period.
    expect(payPeriodFor(day(2026, 7, 5)).index).toBe(payPeriodFor(day(2026, 7, 11)).index);
    expect(payPeriodFor(day(2026, 7, 12)).index).toBe(payPeriodFor(day(2026, 7, 18)).index);
    expect(payPeriodFor(day(2026, 7, 5)).index).toBe(payPeriodFor(day(2026, 7, 18)).index);
  });

  it("rolls over the day after a period ends", () => {
    expect(payPeriodFor(day(2026, 7, 18)).index + 1).toBe(payPeriodFor(day(2026, 7, 19)).index);
  });

  it("extends backwards past the anchor without an off-by-one", () => {
    const before = payPeriodFor(day(2026, 7, 4));
    expect(iso(before.start)).toBe("2026-06-21");
    expect(iso(before.end)).toBe("2026-07-04");
    expect(before.index).toBe(-1);
  });

  it("extends forwards indefinitely", () => {
    const later = payPeriodFor(day(2026, 12, 25));
    expect(later.index).toBeGreaterThan(0);
    expect((later.end.getTime() - later.start.getTime()) / 86_400_000).toBe(13);
  });
});

describe("isPayPeriodEnd", () => {
  it("is true only on the final day", () => {
    expect(isPayPeriodEnd(day(2026, 7, 18))).toBe(true);
    expect(isPayPeriodEnd(day(2026, 8, 1))).toBe(true);
    expect(isPayPeriodEnd(day(2026, 8, 15))).toBe(true);
  });

  it("is false on a start day or mid-period", () => {
    expect(isPayPeriodEnd(day(2026, 7, 5))).toBe(false);
    expect(isPayPeriodEnd(day(2026, 7, 11))).toBe(false);
    expect(isPayPeriodEnd(day(2026, 7, 19))).toBe(false);
  });
});

describe("formatPayPeriod", () => {
  it("reads as a date range", () => {
    expect(formatPayPeriod(payPeriodFor(day(2026, 8, 2)), "America/New_York")).toBe(
      "Aug 2 – Aug 15",
    );
  });
});

// The week grid renders seven columns and marks the ones that end a period.
// These assert the shape the grid depends on: at most one marked column per
// week, and marked only on the fortnight's second Saturday.
describe("marking a Sun–Sat week", () => {
  const week = (sundayY: number, sundayM: number, sundayD: number) =>
    Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(sundayY, sundayM - 1, sundayD + i)));

  it("marks nothing in the first week of a period", () => {
    // 2026-07-05 is a Sunday and starts a period; it ends on the 18th.
    expect(week(2026, 7, 5).filter(isPayPeriodEnd)).toHaveLength(0);
  });

  it("marks exactly the last day in the second week", () => {
    const marked = week(2026, 7, 12).filter(isPayPeriodEnd);
    expect(marked).toHaveLength(1);
    expect(iso(marked[0]!)).toBe("2026-07-18");
  });

  it("marks the boundary in every subsequent fortnight", () => {
    expect(week(2026, 7, 26).filter(isPayPeriodEnd).map(iso)).toEqual(["2026-08-01"]);
    expect(week(2026, 8, 9).filter(isPayPeriodEnd).map(iso)).toEqual(["2026-08-15"]);
  });

  it("never marks a week that lies wholly inside a period", () => {
    expect(week(2026, 8, 2).filter(isPayPeriodEnd)).toHaveLength(0);
  });
});
