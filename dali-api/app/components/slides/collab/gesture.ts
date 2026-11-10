import { LINE_MIN_SIZE, MIN_SIZE, type Placed } from "~/components/slides/deck/freeform";
import {
  angleFromPointer,
  boundsOf,
  rotatedBounds,
  snapMove,
  snapResize,
  type Gap,
  type Guide,
  type Handle,
  type Rect,
  type SnapOptions,
} from "~/components/slides/deck/geometry";

export type GestureKind = { type: "move" } | { type: "resize"; handle: Handle; lockRatio: boolean; thin: boolean } | { type: "rotate" };

export interface Gesture {
  kind: GestureKind;
  start: Map<string, Placed>;
  others: Rect[];
  snap: SnapOptions;
  origin: { x: number; y: number };
}

export interface Modifiers {
  shift: boolean;
  skipSnap: boolean;
}

export interface GestureFrame {
  placed: Map<string, Placed>;
  guides: Guide[];
  gaps: Gap[];
  readout: { x: number; y: number; w: number; h: number; rot: number };
}

/** The selection's rects after the pointer has moved to `pointer` (slide units). Pure: nothing here touches the doc. */
export function applyGesture(g: Gesture, pointer: { x: number; y: number }, mods: Modifiers): GestureFrame {
  const entries = [...g.start.entries()];
  let dx = pointer.x - g.origin.x;
  let dy = pointer.y - g.origin.y;
  const placed = new Map<string, Placed>();
  let guides: Guide[] = [];
  let gaps: Gap[] = [];

  if (g.kind.type === "move") {
    if (mods.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const bounds = boundsOf(entries.map(([, p]) => rotatedBounds(p)));
    const snapped = snapMove(bounds, dx, dy, g.others, g.snap, !mods.skipSnap);
    guides = snapped.guides;
    gaps = snapped.gaps;
    for (const [id, p] of entries) placed.set(id, { ...p, x: p.x + snapped.dx, y: p.y + snapped.dy });
  } else if (g.kind.type === "resize") {
    const [id, p] = entries[0];
    const min = g.kind.thin ? { minW: MIN_SIZE, minH: LINE_MIN_SIZE } : {};
    const out = snapResize(p, g.kind.handle, dx, dy, g.others, g.snap, { lockRatio: g.kind.lockRatio !== mods.shift, ...min }, !mods.skipSnap);
    placed.set(id, out.placed);
    guides = out.guides;
    gaps = out.gaps;
  } else {
    const [id, p] = entries[0];
    const center = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    placed.set(id, { ...p, rot: angleFromPointer(center, pointer, mods.shift) });
  }

  const box = boundsOf([...placed.values()].map(rotatedBounds));
  const first = [...placed.values()][0];
  const single = placed.size === 1;
  return {
    placed,
    guides,
    gaps,
    readout: { x: Math.round(single ? first.x : box.x), y: Math.round(single ? first.y : box.y), w: Math.round(single ? first.w : box.w), h: Math.round(single ? first.h : box.h), rot: first.rot },
  };
}

export const MOVE_SLOP = 3;

/** Whether a pointer has travelled far enough from where it went down to count as a drag, not a click. */
export function isDrag(downPx: { x: number; y: number }, nowPx: { x: number; y: number }): boolean {
  return Math.hypot(nowPx.x - downPx.x, nowPx.y - downPx.y) > MOVE_SLOP;
}

export function marqueeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
