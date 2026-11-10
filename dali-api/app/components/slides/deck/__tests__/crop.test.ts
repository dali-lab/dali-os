import { describe, expect, it } from "vitest";
import { cleanCrop, cropByHandle, cropEqual, cropFrame, fullRect, resetToNatural } from "../crop";

const box = { x: 100, y: 100, w: 400, h: 200, rot: 0 };

describe("cleanCrop", () => {
  it("returns null for nothing to crop, junk or non-objects", () => {
    expect(cleanCrop(undefined)).toBeNull();
    expect(cleanCrop([1, 2])).toBeNull();
    expect(cleanCrop({ l: 0, t: 0, r: 0, b: 0 })).toBeNull();
    expect(cleanCrop({ l: "x", t: NaN })).toBeNull();
  });
  it("clamps fractions and leaves a visible sliver on each axis", () => {
    const c = cleanCrop({ l: -1, t: 0.2, r: 0.99, b: 0.99 })!;
    expect(c.l).toBe(0);
    expect(1 - c.l - c.r).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(1 - c.t - c.b).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });
  it("keeps a sane crop as it is", () => {
    expect(cleanCrop({ l: 0.1, t: 0.2, r: 0.3, b: 0.05 })).toEqual({ l: 0.1, t: 0.2, r: 0.3, b: 0.05 });
  });
});

describe("cropFrame", () => {
  it("is the box itself without a crop", () => {
    expect(cropFrame(box, null)).toEqual({ w: 400, h: 200, left: -0, top: -0 });
  });
  it("scales the whole picture up so only the window shows, offset to the left and top crop", () => {
    const f = cropFrame(box, { l: 0.25, t: 0.5, r: 0.25, b: 0 });
    expect(f.w).toBe(800);
    expect(f.h).toBe(400);
    expect(f.left).toBe(-200);
    expect(f.top).toBe(-200);
  });
  it("puts the whole picture's rect where it sits on the slide", () => {
    expect(fullRect(box, { l: 0.25, t: 0.5, r: 0.25, b: 0 })).toEqual({ x: -100, y: -100, w: 800, h: 400 });
  });
});

describe("cropByHandle", () => {
  it("pulls the right edge in without moving the picture", () => {
    const out = cropByHandle(box, null, "e", -100, 0);
    expect(out.placed).toMatchObject({ x: 100, w: 300 });
    expect(out.crop).toEqual({ l: 0, t: 0, r: 0.25, b: 0 });
    expect(fullRect(out.placed, out.crop)).toEqual({ x: 100, y: 100, w: 400, h: 200 });
  });
  it("pulls the top left corner in and keeps the picture fixed on the slide", () => {
    const first = cropByHandle(box, null, "nw", 40, 20);
    expect(first.placed).toMatchObject({ x: 140, y: 120, w: 360, h: 180 });
    const full = fullRect(first.placed, first.crop);
    expect(full.x).toBeCloseTo(100);
    expect(full.y).toBeCloseTo(100);
    expect(full.w).toBeCloseTo(400);
    expect(full.h).toBeCloseTo(200);
  });
  it("cannot reveal more than the picture, or shrink the window to nothing", () => {
    const out = cropByHandle(box, { l: 0.1, t: 0, r: 0, b: 0 }, "w", -1000, 0);
    expect(out.crop).toBeNull();
    expect(out.placed.x).toBeCloseTo(fullRect(box, { l: 0.1, t: 0, r: 0, b: 0 }).x);
    const tiny = cropByHandle(box, null, "e", -10_000, 0);
    expect(tiny.placed.w).toBeGreaterThanOrEqual(24);
  });
  it("can grow a crop back out, ending with no crop", () => {
    const cropped = cropByHandle(box, null, "e", -100, 0);
    const back = cropByHandle(cropped.placed, cropped.crop, "e", 100, 0);
    expect(back.crop).toBeNull();
    expect(back.placed.w).toBe(400);
  });
});

describe("resetToNatural", () => {
  it("keeps the width and takes the height of the picture's own shape", () => {
    expect(resetToNatural(box, { width: 2000, height: 500 })).toMatchObject({ w: 400, h: 100 });
  });
  it("leaves the box alone when the size is unknown", () => {
    expect(resetToNatural(box, null)).toBe(box);
  });
});

describe("cropEqual", () => {
  it("treats no crop and a zero crop as the same", () => {
    expect(cropEqual(null, { l: 0, t: 0, r: 0, b: 0 })).toBe(true);
    expect(cropEqual({ l: 0.1, t: 0, r: 0, b: 0 }, null)).toBe(false);
  });
});
