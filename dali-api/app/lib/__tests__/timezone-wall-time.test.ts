import { describe, it, expect } from "vitest";
import {
  fromWallClock,
  shiftWallClock,
  toWallClock,
  zonedDayEndUtc,
  zonedDayStartUtc,
  zonedWallTimeUtc,
} from "~/lib/timezone";

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const LONDON = "Europe/London";

const iso = (y: number, m: number, d: number, h: number, min: number, tz: string) =>
  zonedWallTimeUtc(y, m, d, h, min, tz).toISOString();

describe("zonedWallTimeUtc around a fall clock change", () => {
  it.each([
    [0, "2026-11-01T04:00:00.000Z"],
    [1, "2026-11-01T05:00:00.000Z"],
    [2, "2026-11-01T07:00:00.000Z"],
    [3, "2026-11-01T08:00:00.000Z"],
    [5, "2026-11-01T10:00:00.000Z"],
    [6, "2026-11-01T11:00:00.000Z"],
    [9, "2026-11-01T14:00:00.000Z"],
  ])("resolves %i:00 Eastern", (hour, expected) => {
    expect(iso(2026, 11, 1, hour, 0, NY)).toBe(expected);
  });

  it.each([
    [1, "2026-11-01T08:00:00.000Z"],
    [2, "2026-11-01T10:00:00.000Z"],
    [8, "2026-11-01T16:00:00.000Z"],
    [9, "2026-11-01T17:00:00.000Z"],
  ])("resolves %i:00 Pacific", (hour, expected) => {
    expect(iso(2026, 11, 1, hour, 0, LA)).toBe(expected);
  });

  it("picks the first of the repeated hour", () => {
    expect(iso(2026, 11, 1, 1, 30, NY)).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(2026, 10, 25, 1, 30, LONDON)).toBe("2026-10-25T00:30:00.000Z");
  });

  it("resolves a zone east of the prime meridian", () => {
    expect(iso(2026, 10, 25, 0, 30, LONDON)).toBe("2026-10-24T23:30:00.000Z");
    expect(iso(2026, 10, 25, 2, 0, LONDON)).toBe("2026-10-25T02:00:00.000Z");
  });
});

describe("zonedWallTimeUtc around a spring clock change", () => {
  it.each([
    [1, "2027-03-14T06:00:00.000Z"],
    [3, "2027-03-14T07:00:00.000Z"],
    [6, "2027-03-14T10:00:00.000Z"],
    [7, "2027-03-14T11:00:00.000Z"],
    [9, "2027-03-14T13:00:00.000Z"],
  ])("resolves %i:00 Eastern", (hour, expected) => {
    expect(iso(2027, 3, 14, hour, 0, NY)).toBe(expected);
  });

  it("resolves morning hours in Pacific", () => {
    expect(iso(2027, 3, 14, 9, 0, LA)).toBe("2027-03-14T16:00:00.000Z");
  });

  it("moves a skipped time forward past the gap", () => {
    expect(iso(2027, 3, 14, 2, 30, NY)).toBe("2027-03-14T07:30:00.000Z"); // 3:30 EDT
  });
});

describe("zonedWallTimeUtc on ordinary days", () => {
  it("uses the offset in force", () => {
    expect(iso(2026, 7, 1, 14, 0, NY)).toBe("2026-07-01T18:00:00.000Z");
    expect(iso(2026, 1, 15, 14, 0, NY)).toBe("2026-01-15T19:00:00.000Z");
  });

  it("carries overflowing minutes and hours", () => {
    expect(iso(2026, 11, 1, 0, 540, NY)).toBe("2026-11-01T14:00:00.000Z");
    expect(iso(2026, 11, 1, 24, 0, NY)).toBe("2026-11-02T05:00:00.000Z");
  });

  it("keeps a 25-hour and a 23-hour day between their midnights", () => {
    expect(zonedDayEndUtc(2026, 11, 1, NY).getTime() + 1000 - zonedDayStartUtc(2026, 11, 1, NY).getTime()).toBe(
      25 * 3_600_000,
    );
    expect(zonedDayEndUtc(2027, 3, 14, NY).getTime() + 1000 - zonedDayStartUtc(2027, 3, 14, NY).getTime()).toBe(
      23 * 3_600_000,
    );
  });
});

describe("wall clock arithmetic", () => {
  it("round-trips an instant, seconds included", () => {
    const at = new Date("2026-10-20T16:15:42.000Z");
    expect(fromWallClock(toWallClock(at, NY), NY)).toEqual(at);
    expect(toWallClock(at, NY).toISOString()).toBe("2026-10-20T12:15:42.000Z");
  });

  it("keeps the time of day when a shift crosses a clock change", () => {
    const week = 7 * 86_400_000;
    const before = new Date("2026-10-27T18:00:00.000Z"); // Tue 2:00 PM EDT
    expect(shiftWallClock(before, week, NY).toISOString()).toBe("2026-11-03T19:00:00.000Z"); // 2:00 PM EST
    const spring = new Date("2027-03-09T19:00:00.000Z"); // Tue 2:00 PM EST
    expect(shiftWallClock(spring, week, NY).toISOString()).toBe("2027-03-16T18:00:00.000Z"); // 2:00 PM EDT
  });
});
