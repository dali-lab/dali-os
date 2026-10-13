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
});
