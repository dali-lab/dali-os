import * as Y from "yjs";
import { writeBlocks } from "~/components/slides/pptx/fragment-write";
import type { ImportBlock } from "~/components/slides/pptx/import-types";
import { cleanBlocksFor, cleanItems, importBlocksOf, safeImageUrl, serializeSelection, type ClipItem } from "./clipboard";
import { ensureLayoutSlots, insertTracked, posAfter, newId } from "./deck-ops";
import { explicitPlacement } from "./freeform";
import { writeClipItems } from "./freeform-ops";
import { LAYOUTS, layoutById } from "./layouts";
import { elementsOf, isDeleted, newSlideMap, slidesMap, textOf } from "./model";
import { cleanBackground, cleanTransition, type SlideBackground, type SlideTransition } from "./slide-meta";
import type { RenderSlide } from "./snapshot";
import { TEXT_STYLE_IDS, type TextStyleId } from "./themes";

export const SLIDE_CLIP_MARK = "dali-slides-slides";
export const SLIDE_CLIP_VERSION = 1;
const MAX_SLIDES = 50;

export interface SlotClip {
  slot: string;
  blocks?: ImportBlock[];
  textStyle?: TextStyleId;
  src?: string;
  alt?: string;
  placed?: { x: number; y: number; w: number; h: number; rot: number };
}

export interface SlideClip {
  layoutId: string;
  skipped?: boolean;
  background?: SlideBackground;
  transition?: SlideTransition;
  slots: SlotClip[];
  items: ClipItem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function slotClip(slide: RenderSlide, id: string): SlotClip | null {
  const el = slide.elements.find((e) => e.id === id);
  if (!el || !el.slot) return null;
  const placed = explicitPlacement(el);
  return {
    slot: el.slot,
    ...(el.kind === "text" ? { blocks: importBlocksOf(el.blocks) } : { src: el.src ?? "", alt: el.alt ?? "" }),
    ...(el.textStyle ? { textStyle: el.textStyle } : {}),
    ...(placed ? { placed } : {}),
  };
}

/** The clipboard text for slides: their layout, slot content and free elements. Notes and comments do not travel. */
export function serializeSlides(slides: RenderSlide[]): string | null {
  if (slides.length === 0) return null;
  const clips = slides.map((slide) => {
    const free = slide.elements.filter((e) => e.slot === null).map((e) => e.id);
    const raw = free.length ? serializeSelection(slide, free) : null;
    const items = raw ? (JSON.parse(raw) as { items: unknown[] }).items : [];
    const slots = slide.elements.filter((e) => e.slot).map((e) => slotClip(slide, e.id)).filter((c): c is SlotClip => Boolean(c));
    return { layoutId: slide.layoutId, ...(slide.skipped ? { skipped: true } : {}), ...(slide.background ? { background: slide.background } : {}), ...(slide.transition ? { transition: slide.transition } : {}), slots, items };
  });
  return JSON.stringify({ mark: SLIDE_CLIP_MARK, v: SLIDE_CLIP_VERSION, slides: clips });
}

/** The slides as plain clip objects, the form a template stores. Empty when there is nothing to save. */
export function slidesToClips(slides: RenderSlide[]): unknown[] {
  const text = serializeSlides(slides);
  return text ? (JSON.parse(text) as { slides: unknown[] }).slides : [];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cleanSlot(raw: unknown, layoutId: string): SlotClip | null {
  if (!isObj(raw) || typeof raw.slot !== "string") return null;
  const def = layoutById(layoutId).slots.find((s) => s.slot === raw.slot);
  if (!def) return null;
  const out: SlotClip = { slot: def.slot };
  if (def.kind === "text") out.blocks = cleanBlocksFor(raw.blocks);
  else {
    const src = safeImageUrl(raw.src);
    out.src = src ?? "";
    out.alt = typeof raw.alt === "string" ? raw.alt.slice(0, 500) : "";
  }
  if (TEXT_STYLE_IDS.includes(raw.textStyle as TextStyleId)) out.textStyle = raw.textStyle as TextStyleId;
  const p = raw.placed;
  if (isObj(p) && [p.x, p.y, p.w, p.h].every(finite) && (p.w as number) > 0 && (p.h as number) > 0) {
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    out.placed = {
      x: clamp(p.x as number, -4000, 6000),
      y: clamp(p.y as number, -4000, 6000),
      w: clamp(p.w as number, 1, 8000),
      h: clamp(p.h as number, 1, 8000),
      rot: finite(p.rot) ? clamp(p.rot, -360, 360) : 0,
    };
  }
  return out;
}

/** Slides from clipboard text with every field checked, or null when the text is not ours. */
export function parseSlideClipboard(text: string): SlideClip[] | null {
  if (text.length > 10_000_000 || !text.startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || data.mark !== SLIDE_CLIP_MARK || data.v !== SLIDE_CLIP_VERSION || !Array.isArray(data.slides)) return null;
  const out: SlideClip[] = [];
  for (const raw of data.slides.slice(0, MAX_SLIDES)) {
    if (!isObj(raw)) continue;
    const layoutId = LAYOUTS.some((l) => l.id === raw.layoutId) ? String(raw.layoutId) : layoutById(undefined).id;
    const slots = (Array.isArray(raw.slots) ? raw.slots : []).map((s) => cleanSlot(s, layoutId)).filter((s): s is SlotClip => Boolean(s));
    const items = Array.isArray(raw.items) ? (cleanItems(raw.items) ?? []) : [];
    const background = cleanBackground(raw.background);
    const transition = cleanTransition(raw.transition);
    out.push({ layoutId, ...(raw.skipped === true ? { skipped: true } : {}), ...(background ? { background } : {}), ...(transition ? { transition } : {}), slots, items });
  }
  return out.length ? out : null;
}

/** Clips from stored data (a saved template), checked the same way as clipboard text. Null when nothing survives. */
export function sanitizeClips(raw: unknown): SlideClip[] | null {
  if (!Array.isArray(raw)) return null;
  return parseSlideClipboard(JSON.stringify({ mark: SLIDE_CLIP_MARK, v: SLIDE_CLIP_VERSION, slides: raw }));
}

/** Adds the clipped slides after `afterId` in order. One undo step when run inside `deckUndo.step()`. Returns the new slide ids. */
export function pasteSlides(doc: Y.Doc, clips: SlideClip[], afterId: string | null): string[] {
  const ids: string[] = [];
  insertTracked(doc, (hide) => {
    let after = afterId;
    for (const clip of clips) {
      const id = newId();
      const slide = newSlideMap(id, posAfter(doc, after), clip.layoutId);
      slidesMap(doc).set(id, slide);
      ensureLayoutSlots(slide, clip.layoutId);
      if (clip.skipped) slide.set("skipped", true);
      if (clip.background) slide.set("background", clip.background);
      if (clip.transition) slide.set("transition", clip.transition);
      for (const s of clip.slots) {
        const el = elementsOf(slide).get(s.slot);
        if (!el || isDeleted(el)) continue;
        if (s.blocks) {
          const fragment = textOf(slide).get(s.slot);
          if (fragment) writeBlocks(fragment as Y.XmlFragment, s.blocks);
        } else {
          el.set("src", s.src ?? "");
          el.set("alt", s.alt ?? "");
        }
        if (s.textStyle) el.set("textStyle", s.textStyle);
        if (s.placed) for (const [k, v] of Object.entries(s.placed)) el.set(k, v);
      }
      writeClipItems(slide, clip.items, { dx: 0, dy: 0 });
      ids.push(id);
      hide(slide);
      after = id;
    }
  });
  return ids;
}
