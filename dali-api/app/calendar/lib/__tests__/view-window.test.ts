import { describe, it, expect } from "vitest";
import { weekStartIsoForDay } from "~/calendar/lib/view-window";

const NY = "America/New_York";

// The ISO instants below are local midnight in New York (EST = UTC-5,
// EDT = UTC-4), which is what zonedDayStartUtc produces for a week boundary.
describe("weekStartIsoForDay", () => {
  it("resolves a midweek day to the Sunday that starts its week", () => {
    // Wed 2026-03-18 → Sun 2026-03-15.
    expect(weekStartIsoForDay(NY, "2026-03-18")).toBe("2026-03-15T04:00:00.000Z");
  });

  it("keeps a Sunday in its own week rather than the one before", () => {
    // The regression this guards: `new Date("2026-03-15")` is UTC midnight,
    // i.e. Sat Mar 14 20:00 in New York, which would answer Mar 8.
    expect(weekStartIsoForDay(NY, "2026-03-15")).toBe("2026-03-15T04:00:00.000Z");
  });

  it("keeps a Saturday in the week it ends", () => {
    expect(weekStartIsoForDay(NY, "2026-03-21")).toBe("2026-03-15T04:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    // Thu 2026-04-02 belongs to the week starting Sun 2026-03-29.
    expect(weekStartIsoForDay(NY, "2026-04-02")).toBe("2026-03-29T04:00:00.000Z");
  });

  it("anchors the week at local midnight through a DST change", () => {
    // 2026-11-01 is the fall-back Sunday; that week starts at EDT midnight.
    expect(weekStartIsoForDay(NY, "2026-11-04")).toBe("2026-11-01T04:00:00.000Z");
    // The following week starts at EST midnight — an hour later in UTC.
    expect(weekStartIsoForDay(NY, "2026-11-11")).toBe("2026-11-08T05:00:00.000Z");
  });
});
