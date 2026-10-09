import { describe, it, expect } from "vitest";
import {
  MIN_SELECTION,
  moveRect,
  rectFromPoints,
  resizeRect,
  scaleRect,
} from "../screenshot-selection";

const bounds = { width: 800, height: 600 };

describe("rectFromPoints", () => {
  it("normalizes a drag made up and to the left", () => {
    expect(rectFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 }, bounds)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 150,
    });
  });

  it("stops at the image edge when the pointer leaves it", () => {
    expect(rectFromPoints({ x: 700, y: 500 }, { x: 950, y: -40 }, bounds)).toEqual({
      x: 700,
      y: 0,
      width: 100,
      height: 500,
    });
  });
});

describe("moveRect", () => {
  it("keeps the whole box inside the image", () => {
    const rect = { x: 600, y: 400, width: 150, height: 150 };
    expect(moveRect(rect, 500, 500, bounds)).toEqual({ ...rect, x: 650, y: 450 });
    expect(moveRect(rect, -900, -900, bounds)).toEqual({ ...rect, x: 0, y: 0 });
  });
});

describe("resizeRect", () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 };

  it("moves only the dragged edges", () => {
    expect(resizeRect(rect, "se", 50, 20, bounds)).toEqual({ x: 100, y: 100, width: 250, height: 120 });
    expect(resizeRect(rect, "nw", -50, -20, bounds)).toEqual({ x: 50, y: 80, width: 250, height: 120 });
    expect(resizeRect(rect, "e", 50, 999, bounds)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
  });

  it("never lets an edge cross its opposite", () => {
    expect(resizeRect(rect, "w", 900, 0, bounds)).toEqual({
      x: 300 - MIN_SELECTION,
      y: 100,
      width: MIN_SELECTION,
      height: 100,
    });
  });

  it("stops at the image edge", () => {
    expect(resizeRect(rect, "s", 0, 9999, bounds)).toEqual({ x: 100, y: 100, width: 200, height: 500 });
  });
});

describe("scaleRect", () => {
  it("maps the on-screen box to source pixels", () => {
    expect(
      scaleRect({ x: 100, y: 50, width: 200, height: 100 }, bounds, { width: 1600, height: 1200 }),
    ).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it("never reads past the source image", () => {
    const scaled = scaleRect(
      { x: 799.9, y: 0, width: 0.1, height: 600 },
      bounds,
      { width: 1600, height: 1200 },
    );
    expect(scaled.x + scaled.width).toBeLessThanOrEqual(1600);
    expect(scaled.width).toBeGreaterThanOrEqual(1);
  });
});
