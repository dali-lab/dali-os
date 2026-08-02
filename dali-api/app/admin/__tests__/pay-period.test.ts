import { describe, it, expect } from "vitest";
import {
  parsePayPeriodName,
  canonicalizePayPeriodName,
  matchTermForPeriod,
  type TermWindow,
} from "~/admin/lib/pay-period";

// 09/14/2025 is a Sunday, 09/27/2025 a Saturday — a real biweekly shape.
const VALID = "09/14/2025 - 09/27/2025";

describe("parsePayPeriodName", () => {
  it("parses a valid Sun–Sat biweekly period into UTC-midnight dates", () => {
    const p = parsePayPeriodName(VALID);
    expect(p).not.toBeNull();
    expect(p!.name).toBe(VALID);
    expect(p!.startDate.getTime()).toBe(Date.UTC(2025, 8, 14));
    expect(p!.endDate.getTime()).toBe(Date.UTC(2025, 8, 27));
    expect(p!.startDate.getUTCDay()).toBe(0);
    expect(p!.endDate.getUTCDay()).toBe(6);
  });

  it('accepts the " to " separator and canonicalizes the name to " - "', () => {
    const p = parsePayPeriodName("09/14/2025 to 09/27/2025");
    expect(p).not.toBeNull();
    expect(p!.name).toBe(VALID);
  });

  it("zero-pads single-digit months/days in the canonical name", () => {
    const p = parsePayPeriodName("9/14/2025 - 9/27/2025");
    expect(p).not.toBeNull();
    expect(p!.name).toBe(VALID);
  });

  it("rejects a period that does not start on Sunday", () => {
    // 09/15/2025 is a Monday, 09/28/2025 a Sunday.
    expect(parsePayPeriodName("09/15/2025 - 09/28/2025")).toBeNull();
  });

  it("rejects a period that does not end on Saturday", () => {
    // Sunday start but Friday end (12 days).
    expect(parsePayPeriodName("09/14/2025 - 09/26/2025")).toBeNull();
  });

  it("rejects a Sun–Sat span that is not exactly 14 calendar days inclusive", () => {
    // Sunday → Saturday but 4 weeks apart (27 days difference).
    expect(parsePayPeriodName("09/14/2025 - 10/11/2025")).toBeNull();
    // One week (6 days difference).
    expect(parsePayPeriodName("09/14/2025 - 09/20/2025")).toBeNull();
  });

  it("rejects garbage and impossible calendar dates", () => {
    expect(parsePayPeriodName("not a period")).toBeNull();
    expect(parsePayPeriodName("")).toBeNull();
    expect(parsePayPeriodName("02/30/2025 - 03/14/2025")).toBeNull();
  });
});

describe("canonicalizePayPeriodName", () => {
  it('canonicalizes " to " and padding without validating the shape', () => {
    expect(canonicalizePayPeriodName("9/14/2025 to 9/27/2025")).toBe(VALID);
    // Not a valid biweekly shape, but still canonicalizable.
    expect(canonicalizePayPeriodName("09/15/2025 - 09/28/2025")).toBe(
      "09/15/2025 - 09/28/2025",
    );
  });

  it("returns null for unparseable strings", () => {
    expect(canonicalizePayPeriodName("bogus")).toBeNull();
  });
});

describe("matchTermForPeriod", () => {
  // Tests construct their own UTC-midnight terms (the dev seed does not).
  const fall25: TermWindow = {
    id: "term-25f",
    startDate: new Date(Date.UTC(2025, 8, 15)),
    endDate: new Date(Date.UTC(2025, 10, 25)),
  };
  const winter26: TermWindow = {
    id: "term-26w",
    startDate: new Date(Date.UTC(2026, 0, 5)),
    endDate: new Date(Date.UTC(2026, 2, 10)),
  };
  const terms = [fall25, winter26];

  const periodEnding = (y: number, m: number, d: number) => ({
    endDate: new Date(Date.UTC(y, m, d)),
  });

  it("picks the term containing the period's END date", () => {
    expect(matchTermForPeriod(periodEnding(2025, 8, 27), terms)).toBe("term-25f");
    expect(matchTermForPeriod(periodEnding(2026, 0, 17), terms)).toBe("term-26w");
  });

  it("a period straddling the term start still matches the containing term", () => {
    // Starts 09/14 (before fall's 09/15 start) but ends 09/27 inside fall.
    const p = parsePayPeriodName(VALID)!;
    expect(matchTermForPeriod(p, terms)).toBe("term-25f");
  });

  it("falls back to the nearest preceding term in an inter-term gap", () => {
    // Ends 12/06/2025: after fall's end, before winter's start.
    expect(matchTermForPeriod(periodEnding(2025, 11, 6), terms)).toBe("term-25f");
  });

  it("prefers the latest preceding term when several precede", () => {
    // Ends well after both terms → winter26 (latest endDate).
    expect(matchTermForPeriod(periodEnding(2026, 5, 1), terms)).toBe("term-26w");
  });

  it("returns null when the period predates every term", () => {
    expect(matchTermForPeriod(periodEnding(2025, 7, 30), terms)).toBeNull();
  });

  it("returns null when there are no terms at all", () => {
    expect(matchTermForPeriod(periodEnding(2025, 8, 27), [])).toBeNull();
  });

  it("treats a period ending exactly on a term boundary as contained", () => {
    expect(
      matchTermForPeriod({ endDate: new Date(Date.UTC(2025, 10, 25)) }, terms),
    ).toBe("term-25f");
    expect(
      matchTermForPeriod({ endDate: new Date(Date.UTC(2026, 0, 5)) }, terms),
    ).toBe("term-26w");
  });
});
