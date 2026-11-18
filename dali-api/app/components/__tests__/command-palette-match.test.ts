import { describe, expect, it } from "vitest";
import { paletteMatches } from "../command-palette-match";

describe("paletteMatches", () => {
  const item = { title: "New expense", keywords: ["receipt", "reimburse"] };

  it("matches everything for an empty query", () => {
    expect(paletteMatches(item, "")).toBe(true);
  });

  it("matches the title", () => {
    expect(paletteMatches(item, "expense")).toBe(true);
  });

  it("matches a keyword the title doesn't contain", () => {
    expect(paletteMatches(item, "receipt")).toBe(true);
    expect(paletteMatches(item, "reimb")).toBe(true);
  });

  it("misses when neither the title nor a keyword contains the query", () => {
    expect(paletteMatches(item, "partner")).toBe(false);
    expect(paletteMatches({ title: "Refer a partner" }, "receipt")).toBe(false);
  });
});
