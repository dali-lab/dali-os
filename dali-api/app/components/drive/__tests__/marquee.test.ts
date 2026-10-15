import { describe, expect, it } from "vitest";
import {
  MARQUEE_THRESHOLD,
  idsInRect,
  intersects,
  marqueeSelection,
  pastThreshold,
  rectFromPoints,
} from "~/components/drive/marquee";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("rectFromPoints", () => {
  it("orders the corners whichever way the pointer travelled", () => {
    const want = box(10, 20, 50, 80);
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual(want);
    expect(rectFromPoints({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual(want);
    expect(rectFromPoints({ x: 50, y: 20 }, { x: 10, y: 80 })).toEqual(want);
    expect(rectFromPoints({ x: 10, y: 80 }, { x: 50, y: 20 })).toEqual(want);
  });

  it("makes a zero-size rectangle from a single point", () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(box(5, 5, 5, 5));
  });
});

describe("intersects", () => {
  const a = box(0, 0, 10, 10);

  it("is true for overlap, containment and being contained", () => {
    expect(intersects(a, box(5, 5, 15, 15))).toBe(true);
    expect(intersects(a, box(2, 2, 4, 4))).toBe(true);
    expect(intersects(a, box(-5, -5, 20, 20))).toBe(true);
  });

  it("is false when apart on either axis", () => {
    expect(intersects(a, box(11, 0, 20, 10))).toBe(false);
    expect(intersects(a, box(0, 11, 10, 20))).toBe(false);
    expect(intersects(a, box(-20, 0, -1, 10))).toBe(false);
    expect(intersects(a, box(0, -20, 10, -1))).toBe(false);
  });

  it("is false for boxes that only share an edge or a corner", () => {
    expect(intersects(a, box(10, 0, 20, 10))).toBe(false);
    expect(intersects(a, box(0, 10, 10, 20))).toBe(false);
    expect(intersects(a, box(10, 10, 20, 20))).toBe(false);
  });

  it("is symmetric", () => {
    const b = box(5, 5, 15, 15);
    expect(intersects(a, b)).toBe(intersects(b, a));
  });
});

describe("idsInRect", () => {
  const rows = [
    { id: "a", rect: box(0, 0, 100, 30) },
    { id: "b", rect: box(0, 30, 100, 60) },
    { id: "c", rect: box(0, 60, 100, 90) },
  ];

  it("returns the rows the rectangle touches, in the order given", () => {
    expect(idsInRect(rows, box(10, 40, 20, 70))).toEqual(["b", "c"]);
    expect(idsInRect(rows, box(10, 0, 20, 100))).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a rectangle over empty space", () => {
    expect(idsInRect(rows, box(200, 0, 300, 100))).toEqual([]);
    expect(idsInRect([], box(0, 0, 100, 100))).toEqual([]);
  });

  it("does not pick up a row the rectangle only borders", () => {
    expect(idsInRect(rows, box(10, 30, 20, 60))).toEqual(["b"]);
  });
});

describe("pastThreshold", () => {
  it("stays a click until the pointer has travelled further than the threshold", () => {
    expect(MARQUEE_THRESHOLD).toBe(4);
    expect(pastThreshold({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(pastThreshold({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(pastThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    expect(pastThreshold({ x: 10, y: 10 }, { x: 10, y: 4 })).toBe(true);
  });
});

describe("marqueeSelection", () => {
  const base = new Set(["x", "y"]);

  it("replaces the selection by default", () => {
    expect(marqueeSelection(base, ["a", "b"], false)).toEqual(["a", "b"]);
  });

  it("adds to it when shift or cmd was held, without duplicates", () => {
    expect(marqueeSelection(base, ["a", "x"], true)).toEqual(["x", "y", "a"]);
  });

  it("clears it when a replacing drag touches nothing", () => {
    expect(marqueeSelection(base, [], false)).toEqual([]);
    expect(marqueeSelection(base, [], true)).toEqual(["x", "y"]);
  });
});
