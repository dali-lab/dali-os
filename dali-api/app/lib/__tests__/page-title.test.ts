import { describe, expect, it } from "vitest";
import { stripAppTitle } from "~/lib/page-title";

describe("stripAppTitle", () => {
  it("drops the app suffix", () => {
    expect(stripAppTitle("Staffing · DALI OS")).toBe("Staffing");
  });

  it("keeps a title with no suffix", () => {
    expect(stripAppTitle("Staffing")).toBe("Staffing");
  });

  it("keeps the raw title when nothing is left", () => {
    expect(stripAppTitle(" · DALI OS")).toBe(" · DALI OS");
  });

  it("only strips the trailing suffix", () => {
    expect(stripAppTitle("A · B · DALI OS")).toBe("A · B");
  });
});
