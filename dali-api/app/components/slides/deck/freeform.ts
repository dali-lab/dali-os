import { layoutById, STAGE_H, STAGE_W, type LayoutSlot, type SlotRect } from "./layouts";
import type { RenderElement, RenderSlide } from "./snapshot";

export interface Placed extends SlotRect {
  rot: number;
}

export const MIN_SIZE = 24;
export const LINE_MIN_SIZE = 4;

export const FREE_DEFAULTS = {
  text: { w: 720, h: 160 },
  image: { w: 720, h: 480 },
  rect: { w: 480, h: 300 },
  rounded: { w: 480, h: 300 },
  ellipse: { w: 400, h: 400 },
  line: { w: 480, h: 8 },
  arrow: { w: 480, h: 56 },
} as const;

export function explicitPlacement(el: RenderElement): Placed | null {
  const { x, y, w, h } = el;
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h, rot: el.rot ?? 0 };
}

export function isFree(el: RenderElement): boolean {
  return el.slot === null && el.kind !== "group";
}

/** Drawn on its own geometry rather than by a layout slot: free elements, and elements whose slot the layout no longer has. */
export function isFreeRendered(layoutId: string, el: RenderElement): boolean {
  return el.kind !== "group" && !slotOf(layoutId, el.slot) && explicitPlacement(el) !== null;
}

export function isDetached(el: RenderElement): boolean {
  return el.slot !== null && explicitPlacement(el) !== null;
}

export function slotOf(layoutId: string, slot: string | null): LayoutSlot | undefined {
  return slot ? layoutById(layoutId).slots.find((s) => s.slot === slot) : undefined;
}

/** Where an element is drawn: its own geometry, else its layout slot. Free elements with no geometry have no place. */
export function placementOf(layoutId: string, el: RenderElement): Placed | null {
  const own = explicitPlacement(el);
  if (own) return own;
  const slot = slotOf(layoutId, el.slot);
  return slot ? { ...slot.rect, rot: 0 } : null;
}

export interface PlacedElement {
  element: RenderElement;
  placed: Placed;
}

/** Every element that occupies space on the slide, groups excluded, in z order. */
export function placedElements(slide: RenderSlide): PlacedElement[] {
  const out: PlacedElement[] = [];
  for (const element of slide.elements) {
    if (element.kind === "group") continue;
    const placed = placementOf(slide.layoutId, element);
    if (placed) out.push({ element, placed });
  }
  return out;
}

/** Ids a selection acts on: a group stands for its children. */
export function expandToLeaves(slide: RenderSlide, ids: Iterable<string>): string[] {
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el) continue;
    if (el.kind === "group") {
      for (const child of el.children ?? []) if (byId.has(child)) out.add(child);
    } else out.add(id);
  }
  return [...out];
}

/** What a click on an element selects: its group when it has one. */
export function selectionTarget(slide: RenderSlide, id: string): string {
  const el = slide.elements.find((e) => e.id === id);
  return el?.parentId ?? id;
}

export const STAGE_CENTER = { x: STAGE_W / 2, y: STAGE_H / 2 };

/** The slide with some elements drawn at other places, for a drag in progress that the doc does not hold yet. */
export function withPlacements(slide: RenderSlide, overrides: Iterable<ReadonlyMap<string, Placed> | null | undefined>): RenderSlide {
  const maps = [...overrides].filter((m): m is ReadonlyMap<string, Placed> => Boolean(m && m.size));
  if (maps.length === 0) return slide;
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      let placed: Placed | undefined;
      for (const m of maps) placed = m.get(el.id) ?? placed;
      if (!placed) return el;
      return { ...el, x: placed.x, y: placed.y, w: placed.w, h: placed.h, rot: placed.rot || undefined };
    }),
  };
}
