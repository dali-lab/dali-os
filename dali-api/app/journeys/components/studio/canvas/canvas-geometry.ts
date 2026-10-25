// Pure board math and rules for the studio whiteboard: item boxes, who may
// change what, resizing, and the zoom limits. The view math (fit, zoom around a
// point, screen to board) is shared with the journey graph.

import { PIN_RADIUS } from "~/journeys/lib/studio";
import type { CanvasItem, CanvasItemType, Hotspot } from "~/journeys/lib/studio-types";
import type { Point } from "~/journeys/lib/types";
import { contentBounds, type Bounds, type NodeBox } from "~/journeys/components/graph/graph-geometry";

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
export const FIT_PADDING = 0.15;
export const MIN_SIZE = 40;
/** Pointer travel before a press counts as a drag rather than a click. */
export const DRAG_THRESHOLD = 3;

export type CanvasTool = "select" | "sticky" | "text" | "shape" | "pin" | "image" | "hotspot";
export type BoardMode = "learner" | "editor";

export const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  v: "select",
  s: "sticky",
  t: "text",
  r: "shape",
  p: "pin",
  i: "image",
  h: "hotspot",
};

const EDITOR_ONLY_TOOLS: CanvasTool[] = ["image", "hotspot"];

export function toolAllowed(tool: CanvasTool, mode: BoardMode): boolean {
  return mode === "editor" || !EDITOR_ONLY_TOOLS.includes(tool);
}

/** Tools that drop something where the user clicks. */
export function placesOnClick(tool: CanvasTool): tool is Exclude<CanvasTool, "select" | "image"> {
  return tool !== "select" && tool !== "image";
}

// Text labels and pins size to their content; these stand in for fitting and hit tests.
const TEXT_SIZE = { width: 220, height: 32 };
const PIN_SIZE = PIN_RADIUS * 2;

export function itemBox(item: CanvasItem): NodeBox {
  if (item.type === "pin") return { id: item.id, x: item.x, y: item.y, width: PIN_SIZE, height: PIN_SIZE };
  if (item.type === "text") return { id: item.id, x: item.x, y: item.y, width: item.width ?? TEXT_SIZE.width, height: item.height ?? TEXT_SIZE.height };
  return { id: item.id, x: item.x, y: item.y, width: item.width ?? 180, height: item.height ?? 180 };
}

export function hotspotBox(h: Hotspot): NodeBox {
  return { id: h.id, x: h.x, y: h.y, width: h.width, height: h.height };
}

export function boardBounds(items: CanvasItem[], hotspots: Hotspot[] = []): Bounds | null {
  return contentBounds([...items.map(itemBox), ...hotspots.map(hotspotBox)]);
}

/** Learners move their own items and unlocked starter items; editors move anything. */
export function canMove(item: CanvasItem, mode: BoardMode, readOnly: boolean): boolean {
  if (readOnly) return false;
  return mode === "editor" || !item.fromStarter || !item.locked;
}

/** Changing text, colour, size or deleting. Learners can't change starter items at all. */
export function canEdit(item: CanvasItem, mode: BoardMode, readOnly: boolean): boolean {
  if (readOnly) return false;
  return mode === "editor" || !item.fromStarter;
}

export function canEditHotspots(mode: BoardMode, readOnly: boolean): boolean {
  return mode === "editor" && !readOnly;
}

export const RESIZABLE: CanvasItemType[] = ["sticky", "shape", "image"];

export function isResizable(item: CanvasItem): boolean {
  return RESIZABLE.includes(item.type);
}

/** Draw order: images at the back, pins on top. */
export function layer(type: CanvasItemType | "hotspot"): number {
  if (type === "image") return 0;
  if (type === "hotspot") return 5;
  if (type === "pin") return 20;
  return 10;
}

/** Learner pins are numbered in the order they were placed; starter pins aren't. */
export function pinNumbers(items: CanvasItem[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const item of items) if (item.type === "pin" && !item.fromStarter) numbers.set(item.id, numbers.size + 1);
  return numbers;
}

export type Corner = "nw" | "ne" | "sw" | "se";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rect after dragging `corner` by (dx, dy) in board units. The opposite
 * corner stays put, sizes never go under `min`, and `keepAspect` holds the
 * starting ratio (driven by whichever axis moved further).
 */
export function resizeRect(start: Rect, corner: Corner, dx: number, dy: number, keepAspect = false, min = MIN_SIZE): Rect {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  let width = Math.max(min, start.width + (west ? -dx : dx));
  let height = Math.max(min, start.height + (north ? -dy : dy));
  if (keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (Math.abs(width - start.width) / start.width >= Math.abs(height - start.height) / start.height) {
      height = Math.max(min, width / ratio);
      width = height * ratio;
    } else {
      width = Math.max(min, height * ratio);
      height = width / ratio;
    }
  }
  return {
    x: west ? start.x + start.width - width : start.x,
    y: north ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

/** Rounds board coordinates so saved work stays readable. */
export function roundPoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function roundRect(r: Rect): Rect {
  return { ...roundPoint(r), width: Math.round(r.width), height: Math.round(r.height) };
}

export function isTyping(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );
}
