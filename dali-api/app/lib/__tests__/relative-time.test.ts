import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "~/lib/relative-time";

const NOW = new Date("2026-10-13T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("relativeTime", () => {
  it("counts back from the past", () => {
    expect(relativeTime(at(-30_000))).toBe("30 seconds ago");
    expect(relativeTime(at(-5 * MIN))).toBe("5 minutes ago");
    expect(relativeTime(at(-3 * HOUR))).toBe("3 hours ago");
    expect(relativeTime(at(-DAY))).toBe("yesterday");
    expect(relativeTime(at(-4 * DAY))).toBe("4 days ago");
  });

  it("counts forward into the future in the same units", () => {
    expect(relativeTime(at(30_000))).toBe("in 30 seconds");
    expect(relativeTime(at(5 * MIN))).toBe("in 5 minutes");
    expect(relativeTime(at(3 * HOUR))).toBe("in 3 hours");
    expect(relativeTime(at(DAY))).toBe("tomorrow");
    expect(relativeTime(at(4 * DAY))).toBe("in 4 days");
  });

  it("says now for the present", () => {
    expect(relativeTime(at(0))).toBe("now");
  });

  it("counts days up to a month, then names the date", () => {
    expect(relativeTime(at(-30 * DAY))).toBe("30 days ago");
    expect(relativeTime(at(-31 * DAY))).toBe("Sep 12");
    expect(relativeTime(at(-150 * DAY))).toBe("May 16");
    expect(relativeTime(at(31 * DAY))).toBe("Nov 13");
  });

  it("adds the year to a date outside this one", () => {
    expect(relativeTime(at(-400 * DAY))).toBe("Sep 8, 2025");
    expect(relativeTime("2020-03-03T12:00:00Z")).toBe("Mar 3, 2020");
    expect(relativeTime(at(100 * DAY))).toBe("Jan 21, 2027");
  });
});
