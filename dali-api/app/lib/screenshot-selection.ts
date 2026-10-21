// Geometry for the feedback screenshot's drag-to-select box. Pure, so the
// pointer handling in ScreenshotSelector stays thin.

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Smallest box a resize can leave, so the handles never cross. */
export const MIN_SELECTION = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** The box between a drag's anchor and its current point, in either direction. */
export function rectFromPoints(a: Point, b: Point, bounds: Size): Rect {
  const ax = clamp(a.x, 0, bounds.width);
  const ay = clamp(a.y, 0, bounds.height);
  const bx = clamp(b.x, 0, bounds.width);
  const by = clamp(b.y, 0, bounds.height);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  };
}

export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, bounds.width - rect.width),
    y: clamp(rect.y + dy, 0, bounds.height - rect.height),
  };
}

export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Size,
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_SELECTION);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_SELECTION, bounds.width);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_SELECTION);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_SELECTION, bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** On-screen box → source-image pixels, for the crop. */
export function scaleRect(rect: Rect, displayed: Size, natural: Size): Rect {
  const sx = natural.width / displayed.width;
  const sy = natural.height / displayed.height;
  const x = Math.min(Math.round(rect.x * sx), natural.width - 1);
  const y = Math.min(Math.round(rect.y * sy), natural.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(rect.width * sx), natural.width - x)),
    height: Math.max(1, Math.min(Math.round(rect.height * sy), natural.height - y)),
  };
}
