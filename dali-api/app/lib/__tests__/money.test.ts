import { describe, it, expect } from "vitest";
import { decimalToNumber, roundCents, formatUsd } from "~/lib/money";

describe("decimalToNumber", () => {
  it("converts Decimal-like objects via toString", () => {
    expect(decimalToNumber({ toString: () => "16.25" })).toBe(16.25);
  });

  it("passes numbers and numeric strings through", () => {
    expect(decimalToNumber(42.5)).toBe(42.5);
    expect(decimalToNumber("19.00")).toBe(19);
  });

  it("collapses null/undefined/unparseable to 0", () => {
    expect(decimalToNumber(null)).toBe(0);
    expect(decimalToNumber(undefined)).toBe(0);
    expect(decimalToNumber({ toString: () => "nope" })).toBe(0);
  });
});

describe("roundCents", () => {
  it("rounds to whole cents, absorbing float drift", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(16.255)).toBe(16.26);
    expect(roundCents(-2.005)).toBe(-2);
  });
});

describe("formatUsd", () => {
  it("formats as US dollars with grouping", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
