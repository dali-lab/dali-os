import { describe, expect, it } from "vitest";
import { stripAppTitle } from "~/lib/page-title";

describe("stripAppTitle", () => {
  it("drops the app suffix", () => {
    expect(stripAppTitle("Staffing · DALI OS")).toBe("Staffing");
  });

  it("keeps a title with no suffix", () => {
    expect(stripAppTitle("Staffing")).toBe("Staffing");
  });

  it("keeps only the page's own name, not its context", () => {
    expect(stripAppTitle("Geisel wayfinding · Projects · DALI OS")).toBe("Geisel wayfinding");
  });

  it("is empty for the bare app title a page without its own title gets", () => {
    expect(stripAppTitle("DALI OS")).toBe("");
  });

  it("keeps a page that is itself named like the app", () => {
    expect(stripAppTitle("DALI OS · Projects · DALI OS")).toBe("DALI OS");
  });

  it("is empty for an empty title", () => {
    expect(stripAppTitle("")).toBe("");
    expect(stripAppTitle(" · DALI OS")).toBe("");
  });
});
