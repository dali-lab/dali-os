import type { Point } from "~/journeys/lib/types";

export const NODE_WIDTH = 240;
/** Used until a node has been measured; close to a two-line module card. */
export const NODE_HEIGHT = 84;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 1.5;
export const FIT_PADDING = 0.2;
export const EDGE_RADIUS = 8;
/** How far an edge runs straight out of a handle before it may turn. */
export const EDGE_OFFSET = 20;

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Screen = graph * k + (x, y). */
export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  width: number;
  height: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, k: 1 };

export function nodeBox(id: string, position: Point, height = NODE_HEIGHT): NodeBox {
  return { id, x: position.x, y: position.y, width: NODE_WIDTH, height };
}

/** Where edges leave a node: the middle of its right side. */
export function sourceHandle(box: NodeBox): Point {
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

/** Where edges enter a node: the middle of its left side. */
export function targetHandle(box: NodeBox): Point {
  return { x: box.x, y: box.y + box.height / 2 };
}

export function clampZoom(k: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return Math.min(max, Math.max(min, k));
}

export function contentBounds(boxes: NodeBox[]): Bounds | null {
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.width)),
    maxY: Math.max(...boxes.map((b) => b.y + b.height)),
  };
}

/** The transform that centres `bounds` in the viewport with `padding` to spare. */
export function fitTransform(
  bounds: Bounds | null,
  viewport: Size,
  padding = FIT_PADDING,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): Transform {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return IDENTITY;
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const k = clampZoom(Math.min(viewport.width / (w * (1 + padding)), viewport.height / (h * (1 + padding))), min, max);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: viewport.width / 2 - cx * k, y: viewport.height / 2 - cy * k, k };
}

/** Zoom by `factor`, keeping the graph point under `anchor` (viewport coords) still. */
export function zoomAround(t: Transform, anchor: Point, factor: number, min = MIN_ZOOM, max = MAX_ZOOM): Transform {
  const k = clampZoom(t.k * factor, min, max);
  const ratio = k / t.k;
  return { k, x: anchor.x - (anchor.x - t.x) * ratio, y: anchor.y - (anchor.y - t.y) * ratio };
}

/** Viewport coords (relative to the canvas's top-left) to graph coords. */
export function toGraphPoint(t: Transform, p: Point): Point {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}

/** The topmost box containing `p`, or null. Later boxes draw on top. */
export function nodeAt(p: Point, boxes: NodeBox[]): NodeBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return b;
  }
  return null;
}

/** The corners of an orthogonal route from a right-side handle to a left-side handle. */
export function stepPoints(source: Point, target: Point, offset = EDGE_OFFSET): Point[] {
  if (source.y === target.y && target.x >= source.x) return [source, target];
  if (target.x - source.x >= offset * 2) {
    const midX = (source.x + target.x) / 2;
    return [source, { x: midX, y: source.y }, { x: midX, y: target.y }, target];
  }
  // The target sits behind the source: leave right, cross between the two
  // rows, and come back in from the target's left.
  const midY = (source.y + target.y) / 2;
  const outX = source.x + offset;
  const inX = target.x - offset;
  return [source, { x: outX, y: source.y }, { x: outX, y: midY }, { x: inX, y: midY }, { x: inX, y: target.y }, target];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** SVG path data through `points`, each inner corner rounded by up to `radius`. */
export function roundedPath(points: Point[], radius = EDGE_RADIUS): string {
  if (points.length === 0) return "";
  const parts = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) {
      parts.push(`L ${round(cur.x)} ${round(cur.y)}`);
      continue;
    }
    const before = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
    const after = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    parts.push(`L ${round(before.x)} ${round(before.y)}`, `Q ${round(cur.x)} ${round(cur.y)} ${round(after.x)} ${round(after.y)}`);
  }
  const last = points[points.length - 1];
  if (points.length > 1) parts.push(`L ${round(last.x)} ${round(last.y)}`);
  return parts.join(" ");
}

/** A smoothstep edge from one node's right handle to another's left handle. */
export function edgePath(from: NodeBox, to: NodeBox, radius = EDGE_RADIUS): string {
  return roundedPath(stepPoints(sourceHandle(from), targetHandle(to)), radius);
}

/** The connection line while dragging out of a handle towards a free point. */
export function connectionPath(from: NodeBox, to: Point, radius = EDGE_RADIUS): string {
  return roundedPath(stepPoints(sourceHandle(from), to), radius);
}

/** Order-independent identity for a set of nodes, to know when to refit. */
export function boxesKey(boxes: NodeBox[]): string {
  return boxes
    .map((b) => b.id)
    .sort()
    .join("|");
}
