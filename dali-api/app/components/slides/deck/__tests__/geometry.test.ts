import { describe, expect, it } from "vitest";
import {
  alignDeltas,
  angleFromPointer,
  boundsOf,
  distributeDeltas,
  gapsFor,
  intersects,
  normalizeDegrees,
  nudgeDelta,
  resizePlacement,
  rotatedBounds,
  snapMove,
  snapResize,
  type SnapOptions,
} from "../geometry";

const OPTS: SnapOptions = { threshold: 8, items: true, margins: true };
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("rotated bounds", () => {
  it("is the rect itself when not rotated", () => {
    expect(rotatedBounds({ ...box(10, 20, 100, 50), rot: 0 })).toEqual(box(10, 20, 100, 50));
  });

  it("swaps width and height around the center at 90 degrees", () => {
    const b = rotatedBounds({ ...box(100, 100, 200, 100), rot: 90 });
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(50);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });

  it("grows to the diagonal box at 45 degrees", () => {
    const b = rotatedBounds({ ...box(0, 0, 100, 100), rot: 45 });
    expect(b.w).toBeCloseTo(141.42, 1);
    expect(b.h).toBeCloseTo(141.42, 1);
  });

  it("bounds several rects and tests overlap", () => {
    expect(boundsOf([box(0, 0, 10, 10), box(20, 30, 10, 10)])).toEqual(box(0, 0, 30, 40));
    expect(intersects(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(intersects(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
  });

  it("normalizes degrees into -180..180", () => {
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(540)).toBe(180);
    expect(normalizeDegrees(0)).toBe(0);
  });
});

describe("snapMove", () => {
  it("pulls an edge onto another item's edge within the threshold and reports a guide", () => {
    const other = box(500, 300, 200, 100);
    const r = snapMove(box(100, 100, 100, 100), 396, 0, [other], OPTS);
    expect(r.dx).toBe(400);
    expect(r.guides.some((g) => g.axis === "x" && g.pos === 500)).toBe(true);
  });

  it("snaps centers to centers", () => {
    const other = box(500, 300, 200, 100);
    const r = snapMove(box(0, 0, 100, 100), 548, 0, [other], OPTS);
    expect(50 + r.dx).toBe(600);
  });

  it("snaps to the slide margins and the slide center", () => {
    const r = snapMove(box(0, 500, 100, 100), 163, 0, [], OPTS);
    expect(r.dx).toBe(160);
    const center = snapMove(box(0, 0, 200, 100), 858, 0, [], OPTS);
    expect(center.dx).toBe(860);
  });

  it("ignores margins and items when those snaps are off", () => {
    const off = { threshold: 8, items: false, margins: false };
    const r = snapMove(box(0, 500, 100, 100), 163, 0, [box(263, 0, 10, 10)], off);
    expect(r.dx).toBe(163);
  });

  it("leaves the move alone beyond the threshold or when snapping is skipped", () => {
    const other = box(500, 300, 200, 100);
    expect(snapMove(box(100, 100, 100, 100), 380, 0, [other], OPTS).dx).toBe(380);
    const skipped = snapMove(box(100, 100, 100, 100), 396, 0, [other], OPTS, false);
    expect(skipped).toEqual({ dx: 396, dy: 0, guides: [], gaps: [] });
  });

  it("measures the gap to the nearest neighbor that overlaps on the cross axis", () => {
    const gaps = gapsFor(box(100, 100, 100, 100), [box(245, 120, 50, 50), box(400, 300, 50, 50)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ axis: "x", value: 45, from: 200, to: 245 });
  });
});

describe("resizePlacement", () => {
  it("keeps the far corner fixed when dragging south east", () => {
    const r = resizePlacement({ ...box(100, 100, 200, 100), rot: 0 }, "se", 50, 30);
    expect(r).toEqual({ x: 100, y: 100, w: 250, h: 130, rot: 0 });
  });

  it("moves the origin when dragging the north west handle", () => {
    const r = resizePlacement({ ...box(100, 100, 200, 100), rot: 0 }, "nw", -40, -20);
    expect(r).toEqual({ x: 60, y: 80, w: 240, h: 120, rot: 0 });
  });

  it("never goes below the minimum size", () => {
    const r = resizePlacement({ ...box(100, 100, 200, 100), rot: 0 }, "e", -500, 0);
    expect(r.w).toBe(24);
  });

  it("locks the aspect ratio on a corner", () => {
    const r = resizePlacement({ ...box(0, 0, 200, 100), rot: 0 }, "se", 100, 0, { lockRatio: true });
    expect(r.w / r.h).toBeCloseTo(2);
  });

  it("keeps the opposite edge in place for a rotated rect", () => {
    const start = { ...box(100, 100, 200, 100), rot: 90 };
    const before = rotatedBounds(start);
    const next = resizePlacement(start, "e", 0, 50);
    expect(next.w).toBeCloseTo(250);
    const after = rotatedBounds(next);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("snaps an unrotated edge to another item and returns guides", () => {
    const r = snapResize({ ...box(100, 100, 200, 100), rot: 0 }, "e", 197, 0, [box(500, 0, 50, 50)], OPTS);
    expect(r.placed.x + r.placed.w).toBe(500);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  it("does not snap while rotated", () => {
    const r = snapResize({ ...box(100, 100, 200, 100), rot: 10 }, "e", 197, 0, [box(500, 0, 50, 50)], OPTS);
    expect(r.guides).toEqual([]);
  });
});

describe("rotation", () => {
  it("points straight up as zero degrees", () => {
    expect(angleFromPointer({ x: 100, y: 100 }, { x: 100, y: 0 })).toBe(0);
    expect(angleFromPointer({ x: 100, y: 100 }, { x: 200, y: 100 })).toBe(90);
    expect(angleFromPointer({ x: 100, y: 100 }, { x: 0, y: 100 })).toBe(-90);
  });

  it("steps by fifteen degrees with shift", () => {
    expect(angleFromPointer({ x: 0, y: 0 }, { x: 100, y: -90 }, true)).toBe(45);
  });
});

describe("align and distribute", () => {
  const rects = [box(100, 100, 100, 50), box(300, 200, 200, 100)];
  it("aligns to the selection bounds", () => {
    const to = boundsOf(rects);
    expect(alignDeltas(rects, to, "left")).toEqual([{ dx: 0, dy: 0 }, { dx: -200, dy: 0 }]);
    expect(alignDeltas(rects, to, "right")).toEqual([{ dx: 300, dy: 0 }, { dx: 0, dy: 0 }]);
    expect(alignDeltas(rects, to, "top")[1]).toEqual({ dx: 0, dy: -100 });
    expect(alignDeltas(rects, to, "bottom")[0]).toEqual({ dx: 0, dy: 150 });
    expect(alignDeltas(rects, to, "center")[0].dx).toBe(150);
    expect(alignDeltas(rects, to, "middle")[0].dy).toBe(75);
  });

  it("aligns to the slide", () => {
    const slide = box(0, 0, 1920, 1080);
    expect(alignDeltas([box(100, 100, 100, 100)], slide, "center")[0].dx).toBe(810);
    expect(alignDeltas([box(100, 100, 100, 100)], slide, "bottom")[0].dy).toBe(880);
  });

  it("spaces three or more rects evenly and reports the gap", () => {
    const three = [box(0, 0, 100, 10), box(150, 0, 100, 10), box(500, 0, 100, 10)];
    const { deltas, gap } = distributeDeltas(three, "x");
    expect(gap).toBe(150);
    expect(deltas).toEqual([{ dx: 0, dy: 0 }, { dx: 100, dy: 0 }, { dx: 0, dy: 0 }]);
  });

  it("distributes down and leaves two rects alone", () => {
    const col = [box(0, 0, 10, 100), box(0, 120, 10, 100), box(0, 400, 10, 100)];
    expect(distributeDeltas(col, "y").deltas[1]).toEqual({ dx: 0, dy: 80 });
    expect(distributeDeltas(col.slice(0, 2), "y").gap).toBe(0);
  });
});

describe("nudge", () => {
  it("moves one unit, or ten with shift", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ dx: -1, dy: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ dx: 0, dy: 10 });
    expect(nudgeDelta("a", false)).toBeNull();
  });
});
