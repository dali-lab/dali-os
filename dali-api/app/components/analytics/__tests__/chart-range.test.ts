import { describe, expect, it } from "vitest";
import { addDays, dayKeys, daysInclusive, fillDays, isDayKey, orderedRange, rangeLabel } from "../chart-range";

describe("dayKeys", () => {
  it("lists every day with both ends included", () => {
    expect(dayKeys("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("is one day for a single day and empty when reversed", () => {
    expect(dayKeys("2026-10-03", "2026-10-03")).toEqual(["2026-10-03"]);
    expect(dayKeys("2026-10-04", "2026-10-03")).toEqual([]);
  });
});

describe("addDays and daysInclusive", () => {
  it("cross month and year ends in UTC", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysInclusive("2026-10-03", "2026-10-10")).toBe(8);
  });
});

describe("orderedRange", () => {
  it("orders a right-to-left drag", () => {
    expect(orderedRange("2026-10-10", "2026-10-03")).toEqual({ from: "2026-10-03", to: "2026-10-10" });
    expect(orderedRange("2026-10-03", "2026-10-10")).toEqual({ from: "2026-10-03", to: "2026-10-10" });
  });

  it("ignores a click that never left one day", () => {
    expect(orderedRange("2026-10-03", "2026-10-03")).toBeNull();
  });
});

describe("isDayKey", () => {
  it("accepts YYYY-MM-DD only", () => {
    expect(isDayKey("2026-10-03")).toBe(true);
    expect(isDayKey("2026-10-3")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe("fillDays", () => {
  it("zero-fills missing days and drops rows outside the range", () => {
    const rows = [
      { day: "2026-10-01", count: 9 },
      { day: "2026-10-03", count: 4 },
    ];
    expect(fillDays("2026-10-02", "2026-10-04", rows, { count: 0 })).toEqual([
      { day: "2026-10-02", count: 0 },
      { day: "2026-10-03", count: 4 },
      { day: "2026-10-04", count: 0 },
    ]);
  });
});

describe("rangeLabel", () => {
  it("names both ends without a dash", () => {
    expect(rangeLabel("2026-10-03", "2026-11-10")).toBe("Oct 3 to Nov 10");
  });
});
