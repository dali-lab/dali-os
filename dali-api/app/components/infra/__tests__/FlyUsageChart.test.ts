import { describe, expect, it } from "vitest";
import { fmtMs, fmtRate, summarizeFlyDays } from "../FlyUsageChart";

const day = (requests: number, errors: number, p95: number | null, mem: number | null) => ({
  day: "2026-10-24",
  requests,
  errors_5xx: errors,
  p95_ms: p95,
  memory_peak_bytes: mem,
});

describe("summarizeFlyDays", () => {
  it("totals requests and errors and keeps the worst day's p95 and memory", () => {
    expect(summarizeFlyDays([day(1000, 5, 300, 4e8), day(3000, 15, 900, null), day(0, 0, null, 6e8)])).toEqual({
      requests: 4000,
      errors: 20,
      errorRate: 0.005,
      slowestP95: 900,
      peakMemory: 6e8,
    });
  });

  it("has no rate or measurements without traffic", () => {
    expect(summarizeFlyDays([])).toEqual({ requests: 0, errors: 0, errorRate: null, slowestP95: null, peakMemory: null });
  });
});

describe("fmtMs", () => {
  it("shows milliseconds under a second and seconds above", () => {
    expect(fmtMs(412.6)).toBe("413 ms");
    expect(fmtMs(1530)).toBe("1.5 s");
  });
});

describe("fmtRate", () => {
  it("shows two decimals and doesn't round a real error rate down to zero", () => {
    expect(fmtRate(0.0125)).toBe("1.25%");
    expect(fmtRate(0.00002)).toBe("Under 0.01%");
    expect(fmtRate(0)).toBe("0.00%");
  });
});
