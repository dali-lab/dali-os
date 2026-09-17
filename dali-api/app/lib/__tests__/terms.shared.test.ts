import { describe, it, expect } from "vitest";
import {
  nextTermCode,
  dartmouthTermCode,
  daliTermCodeFromDartmouth,
  interimLabel,
} from "../terms.shared";

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

describe("dartmouthTermCode", () => {
  it("maps each season to its registrar start month", () => {
    expect(dartmouthTermCode("26W")).toBe("202601");
    expect(dartmouthTermCode("26S")).toBe("202603");
    expect(dartmouthTermCode("26X")).toBe("202606");
    expect(dartmouthTermCode("26F")).toBe("202609");
  });

  it("keeps Winter in the same calendar year (no academic-year shift)", () => {
    expect(dartmouthTermCode("27W")).toBe("202701");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(dartmouthTermCode(" 26f ")).toBe("202609");
  });

  it("returns '' for junk", () => {
    expect(dartmouthTermCode("")).toBe("");
    expect(dartmouthTermCode("2026F")).toBe("");
    expect(dartmouthTermCode("26Q")).toBe("");
  });
});

describe("daliTermCodeFromDartmouth", () => {
  it("round-trips every season", () => {
    for (const code of ["26W", "26S", "26X", "26F", "27W"]) {
      expect(daliTermCodeFromDartmouth(dartmouthTermCode(code))).toBe(code);
    }
  });

  it("returns '' for a non-term month or malformed code", () => {
    expect(daliTermCodeFromDartmouth("202602")).toBe("");
    expect(daliTermCodeFromDartmouth("2026")).toBe("");
    expect(daliTermCodeFromDartmouth("")).toBe("");
  });
});

describe("interimLabel", () => {
  it("names the break by the term it leads into", () => {
    expect(interimLabel("W")).toBe("Winterim");
    expect(interimLabel("S")).toBe("spring break");
    expect(interimLabel("X")).toBe("summer interim");
    expect(interimLabel("F")).toBe("fall interim");
  });
});
