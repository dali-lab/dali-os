import type { Placed } from "./freeform";
import type { Handle } from "./geometry";

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const MIN_VISIBLE = 0.05;
export const MIN_CROP_SIZE = 24;

const frac = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(0.95, Math.max(0, v)) : 0);

/** A stored crop made safe to draw: fractions in range with at least MIN_VISIBLE of each axis left. Null when it crops nothing. */
export function cleanCrop(value: unknown): Crop | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  let { l, t, r, b } = { l: frac(raw.l), t: frac(raw.t), r: frac(raw.r), b: frac(raw.b) };
  if (1 - l - r < MIN_VISIBLE) {
    const over = MIN_VISIBLE - (1 - l - r);
    l = Math.max(0, l - over / 2);
    r = Math.max(0, r - over / 2);
  }
  if (1 - t - b < MIN_VISIBLE) {
    const over = MIN_VISIBLE - (1 - t - b);
    t = Math.max(0, t - over / 2);
    b = Math.max(0, b - over / 2);
  }
  if (l === 0 && t === 0 && r === 0 && b === 0) return null;
  return { l, t, r, b };
}

export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

export interface CropFrame {
  /** The whole picture's size and offset from the box's top left, in the box's units. */
  w: number;
  h: number;
  left: number;
  top: number;
}

/** Where the whole picture sits relative to the visible box so only the cropped window shows. */
export function cropFrame(box: { w: number; h: number }, crop: Crop | null | undefined): CropFrame {
  const c = crop ?? NO_CROP;
  const w = box.w / (1 - c.l - c.r);
  const h = box.h / (1 - c.t - c.b);
  return { w, h, left: -c.l * w, top: -c.t * h };
}

/** The whole picture's rect on the slide, unrotated. */
export function fullRect(placed: Placed, crop: Crop | null | undefined): { x: number; y: number; w: number; h: number } {
  const f = cropFrame(placed, crop);
  return { x: placed.x + f.left, y: placed.y + f.top, w: f.w, h: f.h };
}

/**
 * Moves one edge or corner of the crop window by (dx, dy) slide units along the picture's own axes, leaving the
 * picture where it is. Returns the new visible box and crop.
 */
export function cropByHandle(placed: Placed, crop: Crop | null | undefined, handle: Handle, dx: number, dy: number): { placed: Placed; crop: Crop | null } {
  const full = fullRect(placed, crop);
  const minW = Math.max(MIN_CROP_SIZE, full.w * MIN_VISIBLE);
  const minH = Math.max(MIN_CROP_SIZE, full.h * MIN_VISIBLE);
  let left = placed.x;
  let top = placed.y;
  let right = placed.x + placed.w;
  let bottom = placed.y + placed.h;
  if (handle.includes("w")) left = Math.min(Math.max(left + dx, full.x), right - minW);
  if (handle.includes("e")) right = Math.max(Math.min(right + dx, full.x + full.w), left + minW);
  if (handle.includes("n")) top = Math.min(Math.max(top + dy, full.y), bottom - minH);
  if (handle.includes("s")) bottom = Math.max(Math.min(bottom + dy, full.y + full.h), top + minH);
  const next = { ...placed, x: left, y: top, w: right - left, h: bottom - top };
  const raw = {
    l: (left - full.x) / full.w,
    t: (top - full.y) / full.h,
    r: (full.x + full.w - right) / full.w,
    b: (full.y + full.h - bottom) / full.h,
  };
  return { placed: next, crop: cleanCrop(raw) };
}

/** The box that shows the whole picture at its natural aspect ratio, keeping the box's width and top left. */
export function resetToNatural(placed: Placed, natural: { width: number; height: number } | null): Placed {
  if (!natural || natural.width <= 0 || natural.height <= 0) return placed;
  return { ...placed, h: Math.max(1, Math.round((placed.w * natural.height) / natural.width)) };
}

export const cropEqual = (a: Crop | null | undefined, b: Crop | null | undefined): boolean => {
  const x = a ?? NO_CROP;
  const y = b ?? NO_CROP;
  return x.l === y.l && x.t === y.t && x.r === y.r && x.b === y.b;
};
