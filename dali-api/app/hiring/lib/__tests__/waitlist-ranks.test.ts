import { describe, expect, it } from "vitest";
import { compactRanks, tiedRanks } from "~/hiring/lib/waitlist";

describe("tiedRanks", () => {
  it("returns ranks held by more than one entry", () => {
    expect([...tiedRanks([1, 1, 2, 3, 3, 3])]).toEqual([1, 3]);
  });

  it("is empty for a clean order", () => {
    expect(tiedRanks([1, 2, 3]).size).toBe(0);
  });
});

describe("compactRanks", () => {
  it("closes gaps and keeps ties tied", () => {
    expect(compactRanks([2, 2, 4, 7])).toEqual([1, 1, 2, 3]);
  });

  it("keeps input order", () => {
    expect(compactRanks([5, 2, 3])).toEqual([3, 1, 2]);
  });

  it("moves two cycles' lists up together after the shared #1 leaves", () => {
    // Cycle A had 1,2,3 and cycle B had 1,2; A's #1 was accepted.
    expect(compactRanks([2, 3, 1, 2])).toEqual([2, 3, 1, 2]);
  });
});
