import { FILL_IDS, SHAPE_KINDS, type FillId, type ShapeKind } from "./model";
import type { RenderElement } from "./snapshot";
import { TEXT_STYLE_IDS, type TextStyleId } from "./themes";

export interface StyleClip {
  kind: "text" | "shape";
  fill?: FillId;
  shape?: ShapeKind;
  textStyle?: TextStyleId;
}

export function styleOf(el: RenderElement | undefined): StyleClip | null {
  if (!el) return null;
  if (el.kind === "shape") return { kind: "shape", ...(el.fill ? { fill: el.fill } : {}), ...(el.shape ? { shape: el.shape } : {}) };
  if (el.kind === "text") return { kind: "text", ...(el.textStyle ? { textStyle: el.textStyle } : {}) };
  return null;
}

export function cleanStyleClip(raw: unknown): StyleClip | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "shape") {
    return {
      kind: "shape",
      ...(FILL_IDS.includes(v.fill as FillId) ? { fill: v.fill as FillId } : {}),
      ...(SHAPE_KINDS.includes(v.shape as ShapeKind) ? { shape: v.shape as ShapeKind } : {}),
    };
  }
  if (v.kind === "text") return { kind: "text", ...(TEXT_STYLE_IDS.includes(v.textStyle as TextStyleId) ? { textStyle: v.textStyle as TextStyleId } : {}) };
  return null;
}

let held: StyleClip | null = null;
const KEY = "dali.slides.style";

export function getStyleClip(): StyleClip | null {
  if (held) return held;
  try {
    const raw = window.localStorage.getItem(KEY);
    held = raw ? cleanStyleClip(JSON.parse(raw)) : null;
  } catch {
    held = null;
  }
  return held;
}

export function setStyleClip(clip: StyleClip | null): void {
  held = clip;
  try {
    if (clip) window.localStorage.setItem(KEY, JSON.stringify(clip));
    else window.localStorage.removeItem(KEY);
  } catch {
    return;
  }
}
