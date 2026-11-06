import { describe, it, expect } from "vitest";
import { matchesQuery } from "./search";

describe("matchesQuery", () => {
  const opt = { value: "p1", label: "Lab Website", description: "Acme Health" };

  it("matches everything on an empty or blank query", () => {
    expect(matchesQuery(opt, "")).toBe(true);
    expect(matchesQuery(opt, "   ")).toBe(true);
  });

  it("matches the label case-insensitively", () => {
    expect(matchesQuery(opt, "website")).toBe(true);
    expect(matchesQuery(opt, " LAB ")).toBe(true);
  });

  it("matches the description", () => {
    expect(matchesQuery(opt, "acme")).toBe(true);
  });

  it("rejects text in neither", () => {
    expect(matchesQuery(opt, "zebra")).toBe(false);
    expect(matchesQuery({ value: "x", label: "Lab" }, "acme")).toBe(false);
  });
});
