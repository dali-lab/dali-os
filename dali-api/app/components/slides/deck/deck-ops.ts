import * as Y from "yjs";
import { layoutById, type SlotName } from "./layouts";
import {
  between,
  comparePos,
  elementsOf,
  isDeleted,
  newElementMap,
  newSlideMap,
  notesOf,
  slidesMap,
  textOf,
  tombstoneSlide,
  restoreSlide,
  deckMap,
  type SlideMap,
} from "./model";
import type { TextStyleId } from "./themes";

export const DECK_LOCAL = Symbol("deck-local");
/** Creating a slide is not undoable: undo would remove its structs while a peer may be typing in it. Delete is the way back. */
export const DECK_CREATE = Symbol("deck-create");

const SLOT_Z: Record<SlotName, number> = { image: 1, title: 2, subtitle: 3, body: 4 };

export const newId = () => crypto.randomUUID();

export function visibleSlideIds(doc: Y.Doc): string[] {
  const rows: Array<{ id: string; pos: number }> = [];
  slidesMap(doc).forEach((slide, id) => {
    if (!isDeleted(slide)) rows.push({ id, pos: Number(slide.get("pos") ?? 0) });
  });
  return rows.sort(comparePos).map((r) => r.id);
}

/** Makes sure every slot the layout draws has an element, reviving tombstoned ones. Existing content is never touched. */
export function ensureLayoutSlots(slide: SlideMap, layoutId: string): void {
  const elements = elementsOf(slide);
  const fragments = textOf(slide);
  for (const slot of layoutById(layoutId).slots) {
    const existing = elements.get(slot.slot);
    if (!existing) elements.set(slot.slot, newElementMap(slot.slot, slot.kind, SLOT_Z[slot.slot], { slot: slot.slot }));
    else if (isDeleted(existing)) existing.set("deleted", false);
    if (slot.kind === "text" && !fragments.get(slot.slot)) fragments.set(slot.slot, new Y.XmlFragment());
  }
}

export function slideMissingSlot(slide: SlideMap): boolean {
  return layoutById(String(slide.get("layoutId"))).slots.some((s) => {
    const el = elementsOf(slide).get(s.slot);
    return !el || isDeleted(el) || (s.kind === "text" && !textOf(slide).get(s.slot));
  });
}

/** Completes every slide's slots. Only for a server-side transaction: clients never create slots after sync. */
export function repairDeckSlots(doc: Y.Doc): void {
  doc.transact(() => {
    slidesMap(doc).forEach((slide) => {
      if (!isDeleted(slide) && slideMissingSlot(slide)) ensureLayoutSlots(slide, String(slide.get("layoutId")));
    });
  }, "repair-slots");
}

function posAfter(doc: Y.Doc, afterId: string | null): number {
  const ids = visibleSlideIds(doc);
  const map = slidesMap(doc);
  const pos = (id: string) => Number(map.get(id)!.get("pos"));
  if (afterId === null) return between(ids.length ? pos(ids[ids.length - 1]) : undefined, undefined);
  const i = ids.indexOf(afterId);
  if (i < 0) return between(ids.length ? pos(ids[ids.length - 1]) : undefined, undefined);
  return between(pos(ids[i]), i + 1 < ids.length ? pos(ids[i + 1]) : undefined);
}

export function addSlide(doc: Y.Doc, layoutId: string, afterId: string | null): string {
  const id = newId();
  doc.transact(() => {
    const slide = newSlideMap(id, posAfter(doc, afterId), layoutId);
    slidesMap(doc).set(id, slide);
    ensureLayoutSlots(slide, layoutId);
  }, DECK_CREATE);
  return id;
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const m = new Y.Map();
    value.forEach((v, k) => m.set(k, cloneValue(v)));
    return m;
  }
  if (value instanceof Y.XmlFragment) {
    const f = new Y.XmlFragment();
    f.insert(0, value.toArray().map((n) => n.clone()) as Array<Y.XmlText | Y.XmlElement>);
    return f;
  }
  return value;
}

export function duplicateSlide(doc: Y.Doc, sourceId: string): string | null {
  const source = slidesMap(doc).get(sourceId);
  if (!source || isDeleted(source)) return null;
  const id = newId();
  doc.transact(() => {
    const copy = newSlideMap(id, posAfter(doc, sourceId), String(source.get("layoutId")));
    source.forEach((value, key) => {
      if (key === "id" || key === "pos" || key === "deleted") return;
      copy.set(key, cloneValue(value));
    });
    slidesMap(doc).set(id, copy);
    ensureLayoutSlots(copy, String(copy.get("layoutId")));
  }, DECK_CREATE);
  return id;
}

/** Slides are never removed from the map: a peer may still be typing in one. */
export function deleteSlide(doc: Y.Doc, id: string, by?: string): void {
  const slide = slidesMap(doc).get(id);
  if (!slide || isDeleted(slide)) return;
  doc.transact(() => {
    tombstoneSlide(slide);
    if (by) slide.set("deletedBy", by);
  }, DECK_LOCAL);
}

export function undeleteSlide(doc: Y.Doc, id: string): void {
  const slide = slidesMap(doc).get(id);
  if (slide && isDeleted(slide)) doc.transact(() => restoreSlide(slide), DECK_LOCAL);
}

/** Moves a slide so it sits at `index` among the visible slides. Only the moved slide's `pos` changes. */
export function moveSlide(doc: Y.Doc, id: string, index: number): void {
  const map = slidesMap(doc);
  const slide = map.get(id);
  if (!slide) return;
  const others = visibleSlideIds(doc).filter((s) => s !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const pos = (sid: string) => Number(map.get(sid)!.get("pos"));
  doc.transact(
    () => slide.set("pos", between(at > 0 ? pos(others[at - 1]) : undefined, at < others.length ? pos(others[at]) : undefined)),
    DECK_LOCAL,
  );
}

export function setLayout(doc: Y.Doc, slideId: string, layoutId: string): void {
  const slide = slidesMap(doc).get(slideId);
  if (!slide) return;
  doc.transact(() => {
    slide.set("layoutId", layoutId);
    ensureLayoutSlots(slide, layoutId);
  }, DECK_LOCAL);
}

export function setThemeId(doc: Y.Doc, themeId: string): void {
  doc.transact(() => deckMap(doc).set("themeId", themeId), DECK_LOCAL);
}

export function setSlotImage(doc: Y.Doc, slideId: string, src: string, alt: string): void {
  const slide = slidesMap(doc).get(slideId);
  if (!slide) return;
  doc.transact(() => {
    ensureLayoutSlots(slide, String(slide.get("layoutId")));
    const el = elementsOf(slide).get("image") ?? newElementMap("image", "image", SLOT_Z.image, { slot: "image" });
    if (!elementsOf(slide).get("image")) elementsOf(slide).set("image", el);
    el.set("deleted", false);
    el.set("src", src);
    el.set("alt", alt);
  }, DECK_LOCAL);
}

export function clearSlotImage(doc: Y.Doc, slideId: string): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get("image");
  if (el) doc.transact(() => el.set("src", ""), DECK_LOCAL);
}

export function setTextStyle(doc: Y.Doc, slideId: string, slot: string, style: TextStyleId | null): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get(slot);
  if (el) doc.transact(() => (style ? el.set("textStyle", style) : el.set("textStyle", null)), DECK_LOCAL);
}

export function slideFragment(doc: Y.Doc, slideId: string, slot: string): Y.XmlFragment | null {
  const slide = slidesMap(doc).get(slideId);
  return (slide && textOf(slide).get(slot)) || null;
}

export function notesFragment(doc: Y.Doc, slideId: string): Y.XmlFragment | null {
  const slide = slidesMap(doc).get(slideId);
  return slide ? notesOf(slide) : null;
}
