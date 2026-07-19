import { describe, it, expect } from "vitest";
import {
  startOfWeekUTC,
  weekNumberInTerm,
  weekStartForNumber,
  weeksInTerm,
} from "../lib/week";

describe("startOfWeekUTC", () => {
  it("returns Monday of the same ISO week for a Wednesday", () => {
    // 2026-06-10 is a Wednesday → Monday is 2026-06-08
    const monday = startOfWeekUTC("2026-06-10T15:30:00Z");
    expect(monday.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("returns Monday for a Sunday (treats Sunday as last day of the week)", () => {
    // 2026-06-14 is a Sunday → Monday of that week is 2026-06-08
    const monday = startOfWeekUTC("2026-06-14T23:59:00Z");
    expect(monday.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("is idempotent on a Monday at midnight UTC", () => {
    const monday = startOfWeekUTC("2026-06-08T00:00:00Z");
    expect(monday.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
});

describe("weekNumberInTerm", () => {
  // Term 26S starts Wed 2026-06-17 → its week-Monday is 2026-06-15 = Week 1.
  const termStart = "2026-06-17T00:00:00Z";

  it("numbers the term's opening week as Week 1", () => {
    expect(weekNumberInTerm("2026-06-17", termStart)).toBe(1);
    // Any day in that same Monday-week is still Week 1.
    expect(weekNumberInTerm("2026-06-21T23:00:00Z", termStart)).toBe(1);
  });

  it("counts subsequent weeks upward", () => {
    expect(weekNumberInTerm("2026-06-29", termStart)).toBe(3);
    expect(weekNumberInTerm("2026-08-17", termStart)).toBe(10);
  });

  it("returns a non-positive number for dates before the term", () => {
    expect(weekNumberInTerm("2026-06-08", termStart)).toBe(0);
    expect(weekNumberInTerm("2026-06-01", termStart)).toBeLessThan(1);
  });
});

describe("weekStartForNumber", () => {
  const termStart = "2026-06-17T00:00:00Z";

  it("is the inverse of weekNumberInTerm", () => {
    for (const week of [1, 3, 10]) {
      const date = weekStartForNumber(termStart, week);
      expect(weekNumberInTerm(date, termStart)).toBe(week);
    }
  });

  it("returns the term's week-Monday for Week 1", () => {
    expect(weekStartForNumber(termStart, 1).toISOString()).toBe(
      "2026-06-15T00:00:00.000Z",
    );
  });
});

describe("weeksInTerm", () => {
  it("spans from the start's week to the end's week inclusive", () => {
    // 2026-06-17 → 2026-09-15 is 13 Monday-weeks apart (Week 14).
    expect(weeksInTerm("2026-06-17", "2026-09-15")).toBe(14);
  });

  it("never returns less than 1", () => {
    expect(weeksInTerm("2026-06-17", "2026-06-17")).toBe(1);
    expect(weeksInTerm("2026-06-17", "2026-06-10")).toBe(1);
  });
});
