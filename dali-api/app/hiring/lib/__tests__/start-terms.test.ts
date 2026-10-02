import { describe, it, expect } from "vitest";
import {
  eligibleStartTerms,
  resolveStartTerms,
  pruneStartTermIds,
  offersStartTermChoice,
  impliedStartTermId,
  isOfferedStartTerm,
  type StartTermOption,
} from "~/hiring/lib/start-terms";

// sortKey = year * 10 + season (W=1, S=2, X=3, F=4), as the Term table stores it.
const T: Record<string, StartTermOption> = {
  "26W": { id: "t-26w", code: "26W", sortKey: 20261 },
  "26S": { id: "t-26s", code: "26S", sortKey: 20262 },
  "26X": { id: "t-26x", code: "26X", sortKey: 20263 },
  "26F": { id: "t-26f", code: "26F", sortKey: 20264 },
  "27W": { id: "t-27w", code: "27W", sortKey: 20271 },
};

// Deliberately sortKey-DESC, the order loadTermOptions hands out, so the
// helpers can't pass by accidentally inheriting their input's order.
const ALL = [T["26F"]!, T["26X"]!, T["26S"]!, T["26W"]!, T["27W"]!].sort(
  (a, b) => b.sortKey - a.sortKey,
);

const codes = (terms: StartTermOption[]) => terms.map((t) => t.code);

describe("eligibleStartTerms", () => {
  it("offers the cycle's own term and everything after it, oldest first", () => {
    expect(codes(eligibleStartTerms(ALL, T["26S"]!.sortKey))).toEqual([
      "26S",
      "26X",
      "26F",
      "27W",
    ]);
  });

  it("excludes terms before the cycle's own term", () => {
    expect(codes(eligibleStartTerms(ALL, T["26S"]!.sortKey))).not.toContain("26W");
  });

  it("includes the cycle's own term — starting in the hiring term is the norm", () => {
    expect(codes(eligibleStartTerms(ALL, T["26F"]!.sortKey))).toEqual(["26F", "27W"]);
  });

  it("applies no floor when the cycle has no term yet", () => {
    expect(codes(eligibleStartTerms(ALL, null))).toEqual([
      "26W",
      "26S",
      "26X",
      "26F",
      "27W",
    ]);
  });

  it("sorts across a year boundary by sortKey, not by code", () => {
    // "27W" < "26X" alphabetically; chronologically it is last.
    const out = codes(eligibleStartTerms([T["27W"]!, T["26X"]!], null));
    expect(out).toEqual(["26X", "27W"]);
  });

  it("returns [] when no term reaches the floor", () => {
    expect(eligibleStartTerms([T["26W"]!], T["26F"]!.sortKey)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [T["26F"]!, T["26S"]!];
    eligibleStartTerms(input, null);
    expect(codes(input)).toEqual(["26F", "26S"]);
  });
});

describe("resolveStartTerms", () => {
  it("reads chronologically whatever order the ids are stored in", () => {
    expect(codes(resolveStartTerms(ALL, ["t-26f", "t-26s"]))).toEqual(["26S", "26F"]);
  });

  it("drops ids with no matching term rather than rendering a blank row", () => {
    expect(codes(resolveStartTerms(ALL, ["t-26s", "t-gone", "t-26f"]))).toEqual([
      "26S",
      "26F",
    ]);
  });

  it("is empty for a cycle with none set", () => {
    expect(resolveStartTerms(ALL, [])).toEqual([]);
  });
});

describe("pruneStartTermIds", () => {
  it("canonicalizes to chronological order, whatever order they were picked in", () => {
    expect(pruneStartTermIds(["t-26f", "t-26s"], ALL, T["26S"]!.sortKey)).toEqual([
      "t-26s",
      "t-26f",
    ]);
  });

  it("drops a term before the cycle's own term", () => {
    expect(pruneStartTermIds(["t-26w", "t-26s"], ALL, T["26S"]!.sortKey)).toEqual([
      "t-26s",
    ]);
  });

  it("drops unknown ids", () => {
    expect(pruneStartTermIds(["t-26s", "t-nope"], ALL, null)).toEqual(["t-26s"]);
  });

  it("de-duplicates", () => {
    expect(pruneStartTermIds(["t-26f", "t-26s", "t-26f"], ALL, null)).toEqual([
      "t-26s",
      "t-26f",
    ]);
  });

  it("puts the earliest offered term first, so impliedStartTermId picks it", () => {
    const kept = pruneStartTermIds(["t-27w", "t-26s"], ALL, null);
    expect(kept[0]).toBe("t-26s");
  });

  it("empties the set when the cycle's term moves past every option", () => {
    expect(pruneStartTermIds(["t-26s", "t-26x"], ALL, T["27W"]!.sortKey)).toEqual([]);
  });

  it("is idempotent", () => {
    const once = pruneStartTermIds(["t-26w", "t-26s", "t-26s"], ALL, T["26S"]!.sortKey);
    expect(pruneStartTermIds(once, ALL, T["26S"]!.sortKey)).toEqual(once);
  });
});

describe("offersStartTermChoice", () => {
  it("needs two terms — one offered term is not a choice", () => {
    expect(offersStartTermChoice([])).toBe(false);
    expect(offersStartTermChoice(["t-26f"])).toBe(false);
    expect(offersStartTermChoice(["t-26f", "t-27w"])).toBe(true);
  });
});

describe("impliedStartTermId", () => {
  it("records the only offered term without asking the applicant", () => {
    expect(impliedStartTermId(["t-26f"])).toBe("t-26f");
  });

  it("stays null when there is nothing to imply", () => {
    expect(impliedStartTermId([])).toBeNull();
    expect(impliedStartTermId(["t-26f", "t-27w"])).toBeNull();
  });
});

describe("isOfferedStartTerm", () => {
  it("accepts an offered term", () => {
    expect(isOfferedStartTerm(["t-26f", "t-27w"], "t-27w")).toBe(true);
  });

  it("rejects a term the cycle does not offer", () => {
    expect(isOfferedStartTerm(["t-26f"], "t-27w")).toBe(false);
  });

  it("rejects an absent pick", () => {
    expect(isOfferedStartTerm(["t-26f"], null)).toBe(false);
    expect(isOfferedStartTerm(["t-26f"], undefined)).toBe(false);
    expect(isOfferedStartTerm(["t-26f"], "")).toBe(false);
  });
});
