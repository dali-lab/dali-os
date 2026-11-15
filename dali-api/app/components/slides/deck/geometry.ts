import { MIN_SIZE, type Placed } from "./freeform";
import { STAGE_H, STAGE_W, type SlotRect } from "./layouts";

export type Rect = SlotRect;
export type Axis = "x" | "y";
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

export const MARGIN_X = 160;
export const MARGIN_TOP = 110;
export const MARGIN_BOTTOM = 950;
export const DEFAULT_THRESHOLD = 8;
export const ROTATE_STEP = 15;

const EPS = 0.5;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const r = rad(deg);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) };
}

/** The axis-aligned box around a rect drawn with its rotation. */
export function rotatedBounds(p: Placed): Rect {
  if (!p.rot) return { x: p.x, y: p.y, w: p.w, h: p.h };
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const corners = [
    rotatePoint(p.x, p.y, cx, cy, p.rot),
    rotatePoint(p.x + p.w, p.y, cx, cy, p.rot),
    rotatePoint(p.x + p.w, p.y + p.h, cx, cy, p.rot),
    rotatePoint(p.x, p.y + p.h, cx, cy, p.rot),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function boundsOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeDegrees(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

export interface Guide {
  axis: Axis;
  pos: number;
  from: number;
  to: number;
}

export interface Gap {
  axis: Axis;
  from: number;
  to: number;
  at: number;
  value: number;
}

export interface Stage {
  w: number;
  h: number;
}

export const SLIDE_STAGE: Stage = { w: STAGE_W, h: STAGE_H };

export interface SnapOptions {
  threshold: number;
  items: boolean;
  margins: boolean;
  stage?: Stage;
}

interface Target {
  pos: number;
  span: [number, number];
}

const lines = (r: Rect, axis: Axis): number[] => (axis === "x" ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h]);
const spanOf = (r: Rect, axis: Axis): [number, number] => (axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);

function targetsFor(axis: Axis, others: Rect[], opts: SnapOptions): Target[] {
  const out: Target[] = [];
  const stage = opts.stage ?? SLIDE_STAGE;
  const full: [number, number] = axis === "x" ? [0, stage.h] : [0, stage.w];
  const size = axis === "x" ? stage.w : stage.h;
  const slide = [0, size / 2, size];
  const margins = axis === "x" ? [MARGIN_X, STAGE_W - MARGIN_X] : [MARGIN_TOP, MARGIN_BOTTOM];
  const slideMargins = stage.w === STAGE_W && stage.h === STAGE_H;
  for (const pos of slide) out.push({ pos, span: full });
  if (opts.margins && slideMargins) for (const pos of margins) out.push({ pos, span: full });
  if (opts.items) for (const r of others) for (const pos of lines(r, axis)) out.push({ pos, span: spanOf(r, axis) });
  return out;
}

function bestDelta(moving: number[], targets: Target[], threshold: number): number {
  let best = Infinity;
  for (const line of moving) {
    for (const t of targets) {
      const d = t.pos - line;
      if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) best = d;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function guidesFor(axis: Axis, rect: Rect, others: Rect[], opts: SnapOptions): Guide[] {
  const out: Guide[] = [];
  const mine = spanOf(rect, axis);
  const stage = opts.stage ?? SLIDE_STAGE;
  for (const line of lines(rect, axis)) {
    for (const t of targetsFor(axis, others, opts)) {
      if (Math.abs(t.pos - line) > EPS) continue;
      const full = t.span[0] === 0 && (t.span[1] === stage.h || t.span[1] === stage.w);
      const from = full ? 0 : Math.min(mine[0], t.span[0]);
      const to = full ? t.span[1] : Math.max(mine[1], t.span[1]);
      if (!out.some((g) => g.pos === t.pos && g.from === from && g.to === to)) out.push({ axis, pos: t.pos, from, to });
    }
  }
  return out;
}

/** The measurements from a rect to its nearest neighbor on each side, where one overlaps it on the cross axis. */
export function gapsFor(rect: Rect, others: Rect[]): Gap[] {
  const out: Gap[] = [];
  const near = (axis: Axis, dir: 1 | -1) => {
    const crossOf = (r: Rect): [number, number] => (axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
    const startOf = (r: Rect) => (axis === "x" ? r.x : r.y);
    const sizeOf = (r: Rect) => (axis === "x" ? r.w : r.h);
    const [c0, c1] = crossOf(rect);
    let best: { gap: number; other: Rect } | null = null;
    for (const o of others) {
      const [o0, o1] = crossOf(o);
      if (Math.min(c1, o1) - Math.max(c0, o0) <= 0) continue;
      const gap = dir === 1 ? startOf(o) - (startOf(rect) + sizeOf(rect)) : startOf(rect) - (startOf(o) + sizeOf(o));
      if (gap < 1) continue;
      if (!best || gap < best.gap) best = { gap, other: o };
    }
    if (!best) return;
    const [o0, o1] = crossOf(best.other);
    const from = dir === 1 ? startOf(rect) + sizeOf(rect) : startOf(best.other) + sizeOf(best.other);
    out.push({ axis, from, to: from + best.gap, at: (Math.max(c0, o0) + Math.min(c1, o1)) / 2, value: Math.round(best.gap) });
  };
  near("x", 1);
  near("x", -1);
  near("y", 1);
  near("y", -1);
  return out;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
  gaps: Gap[];
}

/** Moves a rect by (dx, dy), pulling its edges and center onto nearby lines. `snap: false` leaves the move as it is. */
export function snapMove(start: Rect, dx: number, dy: number, others: Rect[], opts: SnapOptions, snap = true): SnapResult {
  let moved: Rect = { ...start, x: start.x + dx, y: start.y + dy };
  if (snap) {
    const sx = bestDelta(lines(moved, "x"), targetsFor("x", others, opts), opts.threshold);
    const sy = bestDelta(lines(moved, "y"), targetsFor("y", others, opts), opts.threshold);
    moved = { ...moved, x: moved.x + sx, y: moved.y + sy };
    dx += sx;
    dy += sy;
  }
  if (!snap) return { dx, dy, guides: [], gaps: [] };
  return { dx, dy, guides: [...guidesFor("x", moved, others, opts), ...guidesFor("y", moved, others, opts)], gaps: opts.items ? gapsFor(moved, others) : [] };
}

const HANDLE_SIGN: Record<Handle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
  ne: { x: 1, y: -1 },
  nw: { x: -1, y: -1 },
  se: { x: 1, y: 1 },
  sw: { x: -1, y: 1 },
};

export function handleSign(handle: Handle) {
  return HANDLE_SIGN[handle];
}

export interface ResizeOptions {
  lockRatio?: boolean;
  minW?: number;
  minH?: number;
}

/** The rect after dragging `handle` by a pointer delta in slide units. The edge opposite the handle stays where it was, even when rotated. */
export function resizePlacement(start: Placed, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Placed {
  const { x: hx, y: hy } = HANDLE_SIGN[handle];
  const minW = opts.minW ?? MIN_SIZE;
  const minH = opts.minH ?? MIN_SIZE;
  const local = rotatePoint(dx, dy, 0, 0, -start.rot);
  let w = Math.max(minW, start.w + hx * local.x);
  let h = Math.max(minH, start.h + hy * local.y);
  if (opts.lockRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (hx !== 0 && hy !== 0) {
      const scale = Math.max(w / start.w, h / start.h);
      w = Math.max(minW, start.w * scale);
      h = Math.max(minH, w / ratio);
      w = h * ratio < minW ? minW : w;
    } else if (hx !== 0) h = Math.max(minH, w / ratio);
    else w = Math.max(minW, h * ratio);
  }
  const shift = rotatePoint((hx * (w - start.w)) / 2, (hy * (h - start.h)) / 2, 0, 0, start.rot);
  const cx = start.x + start.w / 2 + shift.x;
  const cy = start.y + start.h / 2 + shift.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: start.rot };
}

/** Pulls the moving edges of an unrotated resize onto nearby lines. */
export function snapResize(start: Placed, handle: Handle, dx: number, dy: number, others: Rect[], opts: SnapOptions, resizeOpts: ResizeOptions = {}, snap = true) {
  let next = resizePlacement(start, handle, dx, dy, resizeOpts);
  if (!snap || start.rot) return { placed: next, guides: [] as Guide[], gaps: [] as Gap[] };
  const { x: hx, y: hy } = HANDLE_SIGN[handle];
  let sdx = dx;
  let sdy = dy;
  if (hx !== 0) {
    const edge = hx > 0 ? next.x + next.w : next.x;
    const d = bestDelta([edge], targetsFor("x", others, opts), opts.threshold);
    sdx += d;
  }
  if (hy !== 0) {
    const edge = hy > 0 ? next.y + next.h : next.y;
    const d = bestDelta([edge], targetsFor("y", others, opts), opts.threshold);
    sdy += d;
  }
  next = resizePlacement(start, handle, sdx, sdy, resizeOpts);
  return {
    placed: next,
    guides: [...guidesFor("x", next, others, opts), ...guidesFor("y", next, others, opts)],
    gaps: opts.items ? gapsFor(next, others) : [],
  };
}

/** The rotation that points the handle above an element's center at the pointer. */
export function angleFromPointer(center: { x: number; y: number }, pointer: { x: number; y: number }, step = false): number {
  const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  const snapped = step ? Math.round(deg / ROTATE_STEP) * ROTATE_STEP : Math.round(deg);
  return normalizeDegrees(snapped);
}

/** How far each rect moves to line up with `to`. Rects are the boxes the items occupy, rotated bounds included. */
export function alignDeltas(rects: Rect[], to: Rect, mode: AlignMode): Array<{ dx: number; dy: number }> {
  return rects.map((r) => {
    switch (mode) {
      case "left":
        return { dx: to.x - r.x, dy: 0 };
      case "center":
        return { dx: to.x + to.w / 2 - (r.x + r.w / 2), dy: 0 };
      case "right":
        return { dx: to.x + to.w - (r.x + r.w), dy: 0 };
      case "top":
        return { dx: 0, dy: to.y - r.y };
      case "middle":
        return { dx: 0, dy: to.y + to.h / 2 - (r.y + r.h / 2) };
      case "bottom":
        return { dx: 0, dy: to.y + to.h - (r.y + r.h) };
    }
  });
}

export const SLIDE_RECT: Rect = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/** Equal gaps between three or more rects along an axis, the outer two staying where they are. */
export function distributeDeltas(rects: Rect[], axis: Axis): { deltas: Array<{ dx: number; dy: number }>; gap: number } {
  const zero = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return { deltas: zero, gap: 0 };
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const size = (r: Rect) => (axis === "x" ? r.w : r.h);
  const order = rects.map((r, i) => i).sort((a, b) => pos(rects[a]) - pos(rects[b]));
  const first = rects[order[0]];
  const last = rects[order[order.length - 1]];
  const span = pos(last) + size(last) - pos(first);
  const total = order.reduce((sum, i) => sum + size(rects[i]), 0);
  const gap = (span - total) / (order.length - 1);
  const deltas = rects.map(() => ({ dx: 0, dy: 0 }));
  let cursor = pos(first) + size(first) + gap;
  for (const i of order.slice(1, -1)) {
    const d = cursor - pos(rects[i]);
    deltas[i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += size(rects[i]) + gap;
  }
  return { deltas, gap };
}

export const NUDGE = 1;
export const NUDGE_BIG = 10;

export function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const n = shift ? NUDGE_BIG : NUDGE;
  switch (key) {
    case "ArrowLeft":
      return { dx: -n, dy: 0 };
    case "ArrowRight":
      return { dx: n, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -n };
    case "ArrowDown":
      return { dx: 0, dy: n };
    default:
      return null;
  }
}
