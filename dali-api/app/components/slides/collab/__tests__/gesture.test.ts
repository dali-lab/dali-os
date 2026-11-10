import { describe, expect, it } from "vitest";
import { applyGesture, isDrag, marqueeRect, type Gesture } from "../gesture";

const OPTS = { threshold: 8, items: true, margins: true };
const p = (x: number, y: number, w = 100, h = 100, rot = 0) => ({ x, y, w, h, rot });
const move = (start: Record<string, ReturnType<typeof p>>, others = [] as Array<{ x: number; y: number; w: number; h: number }>): Gesture => ({
  kind: { type: "move" },
  start: new Map(Object.entries(start)),
  others,
  snap: OPTS,
  origin: { x: 0, y: 0 },
});

describe("applyGesture move", () => {
  it("moves every selected item by the same delta and reports a position readout", () => {
    const g = move({ a: p(300, 300), b: p(600, 500) });
    const f = applyGesture(g, { x: 50, y: 20 }, { shift: false, skipSnap: false });
    expect(f.placed.get("a")).toMatchObject({ x: 350, y: 320 });
    expect(f.placed.get("b")).toMatchObject({ x: 650, y: 520 });
    expect(f.readout).toMatchObject({ x: 350, y: 320, w: 400, h: 300 });
  });

  it("snaps to another item and shows a guide, unless snapping is skipped", () => {
    const g = move({ a: p(100, 100) }, [{ x: 500, y: 600, w: 100, h: 100 }]);
    const snapped = applyGesture(g, { x: 397, y: 0 }, { shift: false, skipSnap: false });
    expect(snapped.placed.get("a")!.x).toBe(500);
    expect(snapped.guides.some((x) => x.axis === "x" && x.pos === 500)).toBe(true);
    const free = applyGesture(g, { x: 397, y: 0 }, { shift: false, skipSnap: true });
    expect(free.placed.get("a")!.x).toBe(497);
    expect(free.guides).toEqual([]);
  });

  it("locks to the dominant axis with shift", () => {
    const g = move({ a: p(300, 300) });
    const f = applyGesture(g, { x: 80, y: 20 }, { shift: true, skipSnap: true });
    expect(f.placed.get("a")).toMatchObject({ x: 380, y: 300 });
  });

  it("does not write anything: it only returns rects", () => {
    const start = p(300, 300);
    const g = move({ a: start });
    applyGesture(g, { x: 80, y: 20 }, { shift: false, skipSnap: true });
    expect(g.start.get("a")).toBe(start);
    expect(start).toEqual(p(300, 300));
  });
});

describe("applyGesture resize and rotate", () => {
  it("resizes one item from a handle and reads out its size", () => {
    const g: Gesture = { kind: { type: "resize", handle: "se", lockRatio: false, thin: false }, start: new Map([["a", p(100, 100, 200, 100)]]), others: [], snap: OPTS, origin: { x: 0, y: 0 } };
    const f = applyGesture(g, { x: 51, y: 33 }, { shift: false, skipSnap: true });
    expect(f.placed.get("a")).toMatchObject({ w: 251, h: 133 });
    expect(f.readout).toMatchObject({ w: 251, h: 133 });
  });

  it("keeps an image's ratio on a corner, and shift flips that", () => {
    const g: Gesture = { kind: { type: "resize", handle: "se", lockRatio: true, thin: false }, start: new Map([["a", p(0, 0, 200, 100)]]), others: [], snap: OPTS, origin: { x: 0, y: 0 } };
    const locked = applyGesture(g, { x: 100, y: 0 }, { shift: false, skipSnap: true }).placed.get("a")!;
    expect(locked.w / locked.h).toBeCloseTo(2);
    const freed = applyGesture(g, { x: 100, y: 0 }, { shift: true, skipSnap: true }).placed.get("a")!;
    expect(freed.h).toBe(100);
  });

  it("lets a line get thinner than a box can", () => {
    const g: Gesture = { kind: { type: "resize", handle: "s", lockRatio: false, thin: true }, start: new Map([["a", p(0, 0, 400, 12)]]), others: [], snap: OPTS, origin: { x: 0, y: 0 } };
    expect(applyGesture(g, { x: 0, y: -10 }, { shift: false, skipSnap: true }).placed.get("a")!.h).toBe(4);
  });

  it("rotates around the center and steps with shift", () => {
    const g: Gesture = { kind: { type: "rotate" }, start: new Map([["a", p(100, 100, 200, 200)]]), others: [], snap: OPTS, origin: { x: 200, y: 50 } };
    expect(applyGesture(g, { x: 300, y: 200 }, { shift: false, skipSnap: false }).placed.get("a")!.rot).toBe(90);
    expect(applyGesture(g, { x: 300, y: 100 }, { shift: true, skipSnap: false }).placed.get("a")!.rot).toBe(45);
  });
});

describe("drag detection and marquee", () => {
  it("treats tiny pointer travel as a click", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(true);
  });

  it("builds a marquee from any two corners", () => {
    expect(marqueeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });
});
