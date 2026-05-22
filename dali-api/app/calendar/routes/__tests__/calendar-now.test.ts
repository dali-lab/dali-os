import { describe, it, expect } from "vitest";
import { getZonedHourFraction } from "~/lib/timezone";

// The calendar grid renders 8 AM–9 PM (HOURS = [8..20]); the now-line is shown
// only when the current fractional hour falls inside [8, 21) and hidden
// otherwise. This mirrors the predicate in WeekGrid.
const GRID_MIN_HOUR = 8;
const GRID_MAX_HOUR = 21;
const isNowLineVisible = (frac: number) =>
  frac >= GRID_MIN_HOUR && frac < GRID_MAX_HOUR;

describe("getZonedHourFraction", () => {
  it("returns the fractional hour for noon in America/New_York", () => {
    // 2026-01-15 17:00:00Z is 12:00 EST (UTC-5).
    const frac = getZonedHourFraction(new Date("2026-01-15T17:00:00Z"), "America/New_York");
    expect(frac).toBe(12);
    expect(isNowLineVisible(frac)).toBe(true);
  });

  it("encodes minutes as a fraction of the hour", () => {
    // 2026-01-15 19:30:00Z is 14:30 EST → 14.5.
    const frac = getZonedHourFraction(new Date("2026-01-15T19:30:00Z"), "America/New_York");
    expect(frac).toBe(14.5);
  });

  it("hides the line before 8 AM", () => {
    // 2026-01-15 12:00:00Z is 07:00 EST.
    const frac = getZonedHourFraction(new Date("2026-01-15T12:00:00Z"), "America/New_York");
    expect(frac).toBe(7);
    expect(isNowLineVisible(frac)).toBe(false);
  });

  it("hides the line after 9 PM", () => {
    // 2026-01-15 02:30:00Z is 21:30 EST on 2026-01-14.
    const frac = getZonedHourFraction(new Date("2026-01-15T02:30:00Z"), "America/New_York");
    expect(frac).toBe(21.5);
    expect(isNowLineVisible(frac)).toBe(false);
  });
});
