import { describe, expect, it } from "vitest";
import { collapseMiddle } from "~/lib/collapse-middle";

describe("collapseMiddle", () => {
  it("keeps a short trail whole", () => {
    expect(collapseMiddle([1, 2, 3], 1, 2)).toEqual({ head: [1, 2, 3], hidden: [], tail: [] });
  });

  it("does not fold a single middle item", () => {
    expect(collapseMiddle([1, 2, 3, 4], 1, 2)).toEqual({ head: [1, 2, 3, 4], hidden: [], tail: [] });
  });

  it("folds the middle once two or more items would hide", () => {
    expect(collapseMiddle([1, 2, 3, 4, 5], 1, 2)).toEqual({ head: [1], hidden: [2, 3], tail: [4, 5] });
    expect(collapseMiddle([1, 2, 3, 4, 5, 6, 7], 1, 2)).toEqual({ head: [1], hidden: [2, 3, 4, 5], tail: [6, 7] });
  });

  it("can fold from the very start", () => {
    expect(collapseMiddle([1, 2, 3], 0, 2)).toEqual({ head: [1, 2, 3], hidden: [], tail: [] });
    expect(collapseMiddle([1, 2, 3, 4], 0, 2)).toEqual({ head: [], hidden: [1, 2], tail: [3, 4] });
  });

  it("handles an empty trail", () => {
    expect(collapseMiddle([], 1, 2)).toEqual({ head: [], hidden: [], tail: [] });
  });
});
