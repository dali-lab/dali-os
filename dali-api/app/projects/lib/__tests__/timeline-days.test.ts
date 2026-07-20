import { describe, it, expect, afterEach } from "vitest";
import {
  DAY,
  utcDayStart,
  utcDayOf,
  localTodayUtcDay,
  dayOffset,
  daySpan,
} from "../timeline-days";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("utcDayStart / utcDayOf", () => {
  it("is a fixed point on UTC midnight", () => {
    const t = Date.UTC(2026, 6, 20); // 2026-07-20T00:00:00Z
    expect(utcDayStart(t)).toBe(t);
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(t);
  });

  it("floors mid-day instants to the same UTC day", () => {
    expect(utcDayOf("2026-07-20T23:59:59.999Z")).toBe(Date.UTC(2026, 6, 20));
    expect(utcDayOf("2026-07-20T00:00:00.001Z")).toBe(Date.UTC(2026, 6, 20));
  });

  it("does not shift with the local timezone (the bug this replaces)", () => {
    // Under local startOfDay in America/New_York, a UTC-midnight instant
    // landed on the *previous* local day, drawing bars a day early.
    process.env.TZ = "America/New_York";
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(Date.UTC(2026, 6, 20));
    process.env.TZ = "Pacific/Auckland";
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(Date.UTC(2026, 6, 20));
  });
});

describe("dayOffset", () => {
  it("maps an ISO date to its column index from the range start", () => {
    const min = Date.UTC(2026, 6, 1);
    expect(dayOffset("2026-07-01T00:00:00.000Z", min)).toBe(0);
    // July 20 must land on the column whose header prints "20" (index 19).
    expect(dayOffset("2026-07-20T00:00:00.000Z", min)).toBe(19);
    expect(dayOffset("2026-08-01T00:00:00.000Z", min)).toBe(31);
  });

  it("is timezone-independent", () => {
    const min = Date.UTC(2026, 6, 1);
    process.env.TZ = "America/Los_Angeles";
    expect(dayOffset("2026-07-20T00:00:00.000Z", min)).toBe(19);
  });
});

describe("daySpan", () => {
  it("is inclusive of both endpoints", () => {
    expect(daySpan("2026-07-20T00:00:00.000Z", "2026-07-20T00:00:00.000Z")).toBe(1);
    expect(daySpan("2026-07-01T00:00:00.000Z", "2026-07-14T00:00:00.000Z")).toBe(14);
  });

  it("spans month boundaries", () => {
    expect(daySpan("2026-06-29T00:00:00.000Z", "2026-07-02T00:00:00.000Z")).toBe(4);
  });
});

describe("localTodayUtcDay", () => {
  it("keys the local calendar date, not the UTC one", () => {
    // 2026-07-20T01:00Z is still the evening of July 19 in New York.
    const now = new Date("2026-07-20T01:00:00.000Z");
    process.env.TZ = "America/New_York";
    expect(localTodayUtcDay(now)).toBe(Date.UTC(2026, 6, 19));
    process.env.TZ = "UTC";
    expect(localTodayUtcDay(now)).toBe(Date.UTC(2026, 6, 20));
  });

  it("returns a UTC midnight", () => {
    expect(localTodayUtcDay() % DAY).toBe(0);
  });
});
