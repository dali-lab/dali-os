import { describe, it, expect } from "vitest";
import {
  CARD_COLORS,
  COVER_PATTERNS,
  PATTERN_IDS,
  buildCoverUrl,
  cardColorHex,
  coverGround,
  isPatternCover,
  parseCover,
} from "../CoverPattern";

describe("cover urls", () => {
  it("round trips every pattern with every card color", () => {
    for (const id of PATTERN_IDS) {
      for (const c of CARD_COLORS) {
        expect(parseCover(buildCoverUrl(id, c.id))).toEqual({ id, card: c.id });
      }
    }
  });

  it("leaves the default card color out of the string", () => {
    expect(buildCoverUrl("poster")).toBe("pattern:poster");
    expect(buildCoverUrl("poster", "ink")).toBe("pattern:poster");
    expect(buildCoverUrl("poster", "plum")).toBe("pattern:poster?c=plum");
  });

  it("falls back to the default card color for an unknown one", () => {
    expect(parseCover("pattern:poster?c=nope")).toEqual({ id: "poster", card: "ink" });
  });

  it("ignores the retired decor query", () => {
    expect(parseCover("pattern:poster?d=frame,seal&c=wine")).toEqual({ id: "poster", card: "wine" });
  });

  it("returns null for uploads, blanks and unknown patterns", () => {
    expect(parseCover("uploads/abc.webp")).toBeNull();
    expect(parseCover("https://example.com/a.png")).toBeNull();
    expect(parseCover("pattern:missing")).toBeNull();
    expect(parseCover("pattern:")).toBeNull();
    expect(parseCover("")).toBeNull();
    expect(parseCover(null)).toBeNull();
    expect(isPatternCover("pattern:missing")).toBe(false);
    expect(isPatternCover(buildCoverUrl("poster"))).toBe(true);
  });

  it("resolves card colors and grounds to tokens", () => {
    expect(cardColorHex("plum")).toBe("var(--art-plum)");
    expect(cardColorHex("nope")).toBe("var(--art-ink)");
    expect(cardColorHex(null)).toBe("var(--art-ink)");
    expect(coverGround(buildCoverUrl("poster"))).toBe(COVER_PATTERNS.find((p) => p.id === "poster")!.ground);
  });

  it("uses tokens only, no raw colors", () => {
    for (const p of COVER_PATTERNS) expect(p.ground).toMatch(/^var\(--/);
    for (const c of CARD_COLORS) expect(c.hex).toMatch(/^var\(--/);
  });
});
