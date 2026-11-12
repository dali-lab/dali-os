import { describe, it, expect } from "vitest";
import { describeExtension, formatCloseInstant } from "../CloseDateCard";

describe("describeExtension", () => {
  it("defaults to 48 hours when there is no extension", () => {
    expect(describeExtension(0)).toEqual({ amount: 48, unit: "hours" });
    expect(describeExtension(-5)).toEqual({ amount: 48, unit: "hours" });
  });
  it("uses days for whole-day multiples", () => {
    expect(describeExtension(24 * 3_600_000)).toEqual({ amount: 1, unit: "days" });
    expect(describeExtension(72 * 3_600_000)).toEqual({ amount: 3, unit: "days" });
  });
  it("uses hours otherwise, rounded to the nearest hour", () => {
    expect(describeExtension(36 * 3_600_000)).toEqual({ amount: 36, unit: "hours" });
    expect(describeExtension(23.6 * 3_600_000)).toEqual({ amount: 24 / 24, unit: "days" });
    expect(describeExtension(5.2 * 3_600_000)).toEqual({ amount: 5, unit: "hours" });
  });
});

describe("formatCloseInstant", () => {
  it("renders the instant in Eastern time with the zone label", () => {
    const out = formatCloseInstant(new Date("2026-01-16T04:59:59Z"));
    expect(out).toContain("Thu, Jan 15, 2026");
    expect(out).toContain("11:59 PM");
    expect(out).toMatch(/E[SD]?T$/);
  });
});
