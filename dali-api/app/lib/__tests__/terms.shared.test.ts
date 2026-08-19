import { describe, it, expect } from "vitest";
import { nextTermCode } from "../terms.shared";

describe("nextTermCode", () => {
  it("advances through the seasons W → S → X → F within a year", () => {
    expect(nextTermCode("26W")).toBe("26S");
    expect(nextTermCode("26S")).toBe("26X");
    expect(nextTermCode("26X")).toBe("26F");
  });

  it("rolls Fall into the next year's Winter", () => {
    expect(nextTermCode("26F")).toBe("27W");
    expect(nextTermCode("99F")).toBe("00W");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(nextTermCode(" 26s ")).toBe("26X");
  });

  it("returns '' for an unrecognized code", () => {
    expect(nextTermCode("")).toBe("");
    expect(nextTermCode("2026S")).toBe("");
    expect(nextTermCode("26Q")).toBe("");
  });
});
