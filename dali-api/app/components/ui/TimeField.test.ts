import { describe, expect, it } from "vitest";
import { formatTime12, parseTimeInput } from "./TimeField";

describe("parseTimeInput", () => {
  it("reads bare numbers as 24h", () => {
    expect(parseTimeInput("9")).toBe("09:00");
    expect(parseTimeInput("13")).toBe("13:00");
    expect(parseTimeInput("930")).toBe("09:30");
    expect(parseTimeInput("1345")).toBe("13:45");
    expect(parseTimeInput("0930")).toBe("09:30");
  });

  it("reads colon-separated times", () => {
    expect(parseTimeInput("9:07")).toBe("09:07");
    expect(parseTimeInput("13:05")).toBe("13:05");
  });

  it("applies am/pm meridiems", () => {
    expect(parseTimeInput("9:07 am")).toBe("09:07");
    expect(parseTimeInput("9pm")).toBe("21:00");
    expect(parseTimeInput("12am")).toBe("00:00");
    expect(parseTimeInput("12pm")).toBe("12:00");
    expect(parseTimeInput("1:30 PM")).toBe("13:30");
  });

  it("supports arbitrary (non-15-min) minutes", () => {
    expect(parseTimeInput("9:07")).toBe("09:07");
    expect(parseTimeInput("2:53pm")).toBe("14:53");
  });

  it("rejects malformed or out-of-range input", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("   ")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("25:00")).toBeNull();
    expect(parseTimeInput("9:99")).toBeNull();
    expect(parseTimeInput("13pm")).toBeNull(); // meridiem needs a 1–12 hour
  });
});

describe("formatTime12", () => {
  it("renders 24h values in 12h with a meridiem", () => {
    expect(formatTime12("09:40")).toBe("9:40 AM");
    expect(formatTime12("13:05")).toBe("1:05 PM");
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
    expect(formatTime12("23:59")).toBe("11:59 PM");
  });

  it("returns empty for malformed values", () => {
    expect(formatTime12("")).toBe("");
    expect(formatTime12("nope")).toBe("");
  });

  it("round-trips a parsed value", () => {
    const v = parseTimeInput("2:53pm");
    expect(v).toBe("14:53");
    expect(formatTime12(v!)).toBe("2:53 PM");
  });
});
