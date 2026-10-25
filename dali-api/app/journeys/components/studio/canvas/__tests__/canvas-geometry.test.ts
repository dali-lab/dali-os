import { describe, expect, it } from "vitest";
import {
  boardBounds,
  canEdit,
  canEditHotspots,
  canMove,
  hotspotBox,
  isResizable,
  isTyping,
  itemBox,
  layer,
  MIN_SIZE,
  pinNumbers,
  placesOnClick,
  resizeRect,
  roundPoint,
  roundRect,
  TOOL_SHORTCUTS,
  toolAllowed,
} from "../canvas-geometry";
import { PIN_RADIUS } from "~/journeys/lib/studio";
import type { CanvasItem } from "~/journeys/lib/studio-types";

const item = (extra: Partial<CanvasItem> = {}): CanvasItem => ({ id: "i", type: "sticky", x: 10, y: 20, width: 100, height: 80, ...extra });

describe("tools", () => {
  it("maps every shortcut letter to a tool", () => {
    expect(TOOL_SHORTCUTS).toEqual({ v: "select", s: "sticky", t: "text", r: "shape", p: "pin", i: "image", h: "hotspot" });
  });

  it("keeps image and hotspot tools for editors", () => {
    for (const t of ["select", "sticky", "text", "shape", "pin"] as const) expect(toolAllowed(t, "learner")).toBe(true);
    expect(toolAllowed("image", "learner")).toBe(false);
    expect(toolAllowed("hotspot", "learner")).toBe(false);
    expect(toolAllowed("image", "editor")).toBe(true);
    expect(toolAllowed("hotspot", "editor")).toBe(true);
  });

  it("places on click for every tool but select and image", () => {
    expect(placesOnClick("select")).toBe(false);
    expect(placesOnClick("image")).toBe(false);
    for (const t of ["sticky", "text", "shape", "pin", "hotspot"] as const) expect(placesOnClick(t)).toBe(true);
  });
});

describe("boxes", () => {
  it("uses an item's own size when it has one", () => {
    expect(itemBox(item())).toEqual({ id: "i", x: 10, y: 20, width: 100, height: 80 });
  });

  it("sizes pins from their radius and gives text and unsized items a stand-in size", () => {
    expect(itemBox(item({ type: "pin", width: undefined, height: undefined }))).toMatchObject({ width: PIN_RADIUS * 2, height: PIN_RADIUS * 2 });
    expect(itemBox(item({ type: "text", width: undefined, height: undefined }))).toMatchObject({ width: 220, height: 32 });
    expect(itemBox(item({ type: "shape", width: undefined, height: undefined }))).toMatchObject({ width: 180, height: 180 });
  });

  it("covers items and hotspots in the board bounds", () => {
    const h = { id: "h", label: "", x: -50, y: 0, width: 20, height: 300 };
    expect(hotspotBox(h)).toEqual({ id: "h", x: -50, y: 0, width: 20, height: 300 });
    expect(boardBounds([item()], [h])).toEqual({ minX: -50, minY: 0, maxX: 110, maxY: 300 });
    expect(boardBounds([], [])).toBeNull();
  });
});

describe("who may change what", () => {
  const own = item();
  const starter = item({ fromStarter: true });
  const lockedStarter = item({ fromStarter: true, locked: true });

  it("lets learners move their own and unlocked starter items, never locked ones", () => {
    expect(canMove(own, "learner", false)).toBe(true);
    expect(canMove(starter, "learner", false)).toBe(true);
    expect(canMove(lockedStarter, "learner", false)).toBe(false);
  });

  it("lets learners edit only their own items", () => {
    expect(canEdit(own, "learner", false)).toBe(true);
    expect(canEdit(starter, "learner", false)).toBe(false);
  });

  it("lets editors move and edit anything", () => {
    expect(canMove(lockedStarter, "editor", false)).toBe(true);
    expect(canEdit(lockedStarter, "editor", false)).toBe(true);
  });

  it("allows nothing on a read-only board", () => {
    expect(canMove(own, "editor", true)).toBe(false);
    expect(canEdit(own, "editor", true)).toBe(false);
    expect(canEditHotspots("editor", true)).toBe(false);
  });

  it("lets only editors change hotspots", () => {
    expect(canEditHotspots("editor", false)).toBe(true);
    expect(canEditHotspots("learner", false)).toBe(false);
  });

  it("resizes stickies, shapes and images only", () => {
    for (const type of ["sticky", "shape", "image"] as const) expect(isResizable(item({ type }))).toBe(true);
    expect(isResizable(item({ type: "text" }))).toBe(false);
    expect(isResizable(item({ type: "pin" }))).toBe(false);
  });
});

describe("layers and pins", () => {
  it("draws images at the back and pins on top", () => {
    expect(layer("image")).toBeLessThan(layer("hotspot"));
    expect(layer("hotspot")).toBeLessThan(layer("sticky"));
    expect(layer("sticky")).toBe(layer("text"));
    expect(layer("text")).toBeLessThan(layer("pin"));
  });

  it("numbers only the learner's pins, in order", () => {
    const items = [
      item({ id: "a", type: "pin", fromStarter: true }),
      item({ id: "b", type: "pin" }),
      item({ id: "c", type: "sticky" }),
      item({ id: "d", type: "pin" }),
    ];
    expect([...pinNumbers(items)]).toEqual([
      ["b", 1],
      ["d", 2],
    ]);
  });
});

describe("resizeRect", () => {
  const start = { x: 0, y: 0, width: 100, height: 50 };

  it("grows from the south-east corner, keeping the top-left still", () => {
    expect(resizeRect(start, "se", 20, 10)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
  });

  it("keeps the opposite corner still from every other corner", () => {
    expect(resizeRect(start, "nw", 10, 10)).toEqual({ x: 10, y: 10, width: 90, height: 40 });
    expect(resizeRect(start, "ne", 10, 10)).toEqual({ x: 0, y: 10, width: 110, height: 40 });
    expect(resizeRect(start, "sw", 10, 10)).toEqual({ x: 10, y: 0, width: 90, height: 60 });
  });

  it("never shrinks under the minimum, and stays anchored when clamped", () => {
    expect(resizeRect(start, "se", -500, -500)).toEqual({ x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE });
    expect(resizeRect(start, "nw", 500, 500)).toEqual({ x: 100 - MIN_SIZE, y: 50 - MIN_SIZE, width: MIN_SIZE, height: MIN_SIZE });
  });

  it("keeps the aspect ratio when asked, following the axis that moved more", () => {
    expect(resizeRect(start, "se", 100, 0, true)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(resizeRect(start, "se", 0, 50, true)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(resizeRect(start, "nw", -100, 0, true)).toEqual({ x: -100, y: -50, width: 200, height: 100 });
  });

  it("respects the minimum while keeping the ratio", () => {
    const r = resizeRect(start, "se", -1000, 0, true);
    expect(r.height).toBe(MIN_SIZE);
    expect(r.width).toBe(MIN_SIZE * 2);
  });
});

describe("rounding", () => {
  it("rounds points and rects", () => {
    expect(roundPoint({ x: 1.4, y: 2.6 })).toEqual({ x: 1, y: 3 });
    expect(roundRect({ x: 0.5, y: 1.2, width: 10.7, height: 9.2 })).toEqual({ x: 1, y: 1, width: 11, height: 9 });
  });
});

describe("isTyping", () => {
  it("is false without an element", () => {
    expect(isTyping(null)).toBe(false);
  });
});
