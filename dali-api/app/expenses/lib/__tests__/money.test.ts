import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatCents, parseMoneyToCents } from "../money";

describe("parseMoneyToCents", () => {
  it.each([
    ["$1,234.56", 123456],
    ["(12.00)", -1200],
    ["-12.00", -1200],
    ["12.00-", -1200],
    ["36.87", 3687],
    ["5", 500],
    ["0.5", 50],
    [".99", 99],
    ["+4.10", 410],
    [" $ 7.00 ", 700],
  ])("reads %s", (raw, cents) => expect(parseMoneyToCents(raw)).toBe(cents));

  it.each(["", "abc", "1.2.3", "$", "--1"])("rejects %j", (raw) => expect(parseMoneyToCents(raw)).toBeNull());

  it("never drifts on float-hostile values", () => {
    expect(parseMoneyToCents("1.15")).toBe(115);
    expect(parseMoneyToCents(1.15)).toBe(115);
    expect(parseMoneyToCents(0.07)).toBe(7);
    expect(parseMoneyToCents(null)).toBeNull();
  });
});

describe("cents formatting", () => {
  it("round-trips to decimal strings", () => {
    expect(centsToDecimalString(3687)).toBe("36.87");
    expect(centsToDecimalString(-5)).toBe("-0.05");
  });
  it("formats with grouping", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-100)).toBe("-$1.00");
  });
});
