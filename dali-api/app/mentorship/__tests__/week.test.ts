import { describe, it, expect } from "vitest";
import { startOfWeekUTC } from "../lib/week";

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
