import type { Placed, PlacedLive } from "~/components/slides/deck/freeform";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import type { RichDoc } from "~/components/slides/types";
import {
  defaultFit,
  fieldBox,
  upgradeLegacyField,
  type CertificateFieldKey,
  type PlacedField,
} from "./certificate-fields";

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function newField(key: CertificateFieldKey, bgHeight: number): PlacedField {
  return {
    key,
    x: 0.15,
    y: 0.45,
    w: 0.7,
    fontSize: Math.round(bgHeight * 0.05),
    color: "#1c2b4a",
    align: "center",
    bold: true,
    fit: defaultFit(key),
  };
}

export function fieldsToSlide(
  fields: PlacedField[],
  bgW: number,
  bgH: number,
  heights: Partial<Record<CertificateFieldKey, number>> = {},
  live: ReadonlyMap<string, PlacedLive> | null = null,
): RenderSlide {
  const elements: RenderElement[] = fields.map((f, z) => {
    const box = fieldBox(f, bgW, bgH);
    const p = live?.get(f.key);
    return {
      id: f.key,
      kind: "text",
      slot: null,
      z,
      blocks: [] as unknown as RichDoc,
      src: null,
      alt: null,
      textStyle: null,
      x: p?.x ?? box.x,
      y: p?.y ?? box.y,
      w: p?.w ?? box.w,
      h: p?.h ?? (heights[f.key] || box.h),
    };
  });
  return { id: "certificate", pos: 0, layoutId: "blank", elements };
}

export function applyPlacements(
  fields: PlacedField[],
  updates: Record<string, Placed>,
  bgW: number,
  bgH: number,
): PlacedField[] {
  return fields.map((f) => {
    const p = updates[f.key];
    if (!p) return f;
    const b = upgradeLegacyField(f);
    const w = clamp(round4(p.w / bgW), 0.05, 1);
    const x = clamp(round4(p.x / bgW), 0, 1 - w);
    const y = clamp(round4(p.y / bgH), 0, 1);
    return { ...b, x, y, w };
  });
}

export function nudgeFields(
  fields: PlacedField[],
  keys: string[],
  dx: number,
  dy: number,
  bgW: number,
  bgH: number,
): PlacedField[] {
  const updates: Record<string, Placed> = {};
  for (const f of fields) {
    if (!keys.includes(f.key)) continue;
    const box = fieldBox(f, bgW, bgH);
    updates[f.key] = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h, rot: 0 };
  }
  return applyPlacements(fields, updates, bgW, bgH);
}

export type History = { past: PlacedField[][]; present: PlacedField[]; future: PlacedField[][] };

const HISTORY_LIMIT = 100;

export const startHistory = (present: PlacedField[]): History => ({ past: [], present, future: [] });

export function pushHistory(h: History, next: PlacedField[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
