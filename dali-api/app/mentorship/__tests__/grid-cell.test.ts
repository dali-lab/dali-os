import { describe, it, expect } from "vitest";
import { isUnfilled, type UnfilledCell } from "../lib/grid-cell";

const cell = (over: Partial<UnfilledCell>): UnfilledCell => ({
  state: "missing",
  vibe: null,
  ...over,
});

describe("isUnfilled", () => {
  it("is true for a due week with no note (missing)", () => {
    expect(isUnfilled(cell({ state: "missing", vibe: null }))).toBe(true);
  });

  it("is true for a note that exists but has no rating", () => {
    expect(isUnfilled(cell({ state: "submitted", vibe: null }))).toBe(true);
  });

  it("is false for a note with a rating", () => {
    for (const vibe of ["Good", "Ok", "Bad"] as const) {
      expect(isUnfilled(cell({ state: "submitted", vibe }))).toBe(false);
    }
  });

  it("is false for a future week (not yet due)", () => {
    expect(isUnfilled(cell({ state: "future", vibe: null }))).toBe(false);
  });
});
