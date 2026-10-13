export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

/** Pointer travel below this is a click, not the start of a selection rectangle. */
export const MARQUEE_THRESHOLD = 4;

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Rectangles that only share an edge do not intersect. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** The ids whose box meets `rect`, in the order given. */
export function idsInRect(rects: ReadonlyArray<{ id: string; rect: Rect }>, rect: Rect): string[] {
  return rects.filter((r) => intersects(r.rect, rect)).map((r) => r.id);
}

export function pastThreshold(a: Point, b: Point, threshold = MARQUEE_THRESHOLD): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > threshold;
}

/** Replace the selection, or grow it when the gesture began with shift or cmd/ctrl held. */
export function marqueeSelection(base: ReadonlySet<string>, hits: readonly string[], additive: boolean): string[] {
  return additive ? [...new Set([...base, ...hits])] : [...hits];
}
