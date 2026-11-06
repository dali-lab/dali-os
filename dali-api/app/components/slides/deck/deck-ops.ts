import * as Y from "yjs";
import { BUILD_EFFECTS, MAX_BUILD_DELAY, type BuildEffect } from "./builds";
import type { BuildPatch } from "./build-order";
import { layoutById, SLOT_Z } from "./layouts";
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
  isRemovedSlot,
  reviveSlot,
  deckMap,
  type SlideMap,
} from "./model";
import { cleanBackground, cleanSection, cleanTransition, sectionsOf, type SlideBackground, type SlideTransition } from "./slide-meta";
import type { TextStyleId } from "./themes";

export const DECK_LOCAL = Symbol("deck-local");
/** Untracked by undo: the first half of every insert (see insertTracked), PPTX import and text auto-height. */
export const DECK_CREATE = Symbol("deck-create");


type Hide = (map: Y.Map<unknown>) => void;

/**
 * Every insert goes through here. `build` writes new entries (and their text fragments) in an untracked
 * transaction, marking each entry it wants undoable with `hide`; those entries are written deleted. A second,
 * tracked transaction then clears `deleted`, so undo tombstones the insert and redo brings it back. Nothing is
 * ever hard-removed, so a peer typing into a new element is never cut off. Run it inside `deckUndo.step()` to
 * make the whole gesture one history entry.
 */
export function insertTracked<T>(doc: Y.Doc, build: (hide: Hide) => T): T {
  const hidden: Array<Y.Map<unknown>> = [];
  let out!: T;
  doc.transact(() => {
    out = build((map) => void hidden.push(map));
    for (const map of hidden) map.set("deleted", true);
  }, DECK_CREATE);
  doc.transact(() => {
    for (const map of hidden) {
      map.set("deleted", false);
      if (map.has("deletedBy")) map.delete("deletedBy");
    }
  }, DECK_LOCAL);
  return out;
}

export const newId = () => crypto.randomUUID();

export function visibleSlideIds(doc: Y.Doc): string[] {
  const rows: Array<{ id: string; pos: number }> = [];
  slidesMap(doc).forEach((slide, id) => {
    if (!isDeleted(slide)) rows.push({ id, pos: Number(slide.get("pos") ?? 0) });
  });
  return rows.sort(comparePos).map((r) => r.id);
}

/** Existing content is never touched. Boxes someone removed stay removed unless `reviveRemoved`. */
export function ensureLayoutSlots(slide: SlideMap, layoutId: string, reviveRemoved = false): void {
  const elements = elementsOf(slide);
  const fragments = textOf(slide);
  for (const slot of layoutById(layoutId).slots) {
    const existing = elements.get(slot.slot);
    if (!existing) elements.set(slot.slot, newElementMap(slot.slot, slot.kind, SLOT_Z[slot.slot], { slot: slot.slot }));
    else if (isRemovedSlot(existing)) {
      if (reviveRemoved) reviveSlot(existing);
    } else if (isDeleted(existing)) existing.set("deleted", false);
    if (slot.kind === "text" && !fragments.get(slot.slot)) fragments.set(slot.slot, new Y.XmlFragment());
  }
}

export function slideMissingSlot(slide: SlideMap): boolean {
  return layoutById(String(slide.get("layoutId"))).slots.some((s) => {
    const el = elementsOf(slide).get(s.slot);
    if (el && isRemovedSlot(el)) return false;
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

export function posAfter(doc: Y.Doc, afterId: string | null): number {
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
  insertTracked(doc, (hide) => {
    const slide = newSlideMap(id, posAfter(doc, afterId), layoutId);
    slidesMap(doc).set(id, slide);
    ensureLayoutSlots(slide, layoutId);
    hide(slide);
  });
  return id;
}

export function cloneValue(value: unknown): unknown {
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
  insertTracked(doc, (hide) => {
    const copy = newSlideMap(id, posAfter(doc, sourceId), String(source.get("layoutId")));
    source.forEach((value, key) => {
      if (key === "id" || key === "pos" || key === "deleted" || key === "section") return;
      copy.set(key, cloneValue(value));
    });
    slidesMap(doc).set(id, copy);
    ensureLayoutSlots(copy, String(copy.get("layoutId")));
    hide(copy);
  });
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
    ensureLayoutSlots(slide, layoutId, true);
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
    reviveSlot(el);
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

export function setBuild(doc: Y.Doc, slideId: string, slot: string, build: number | null): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get(slot);
  if (el) doc.transact(() => el.set("build", build && build >= 1 ? Math.floor(build) : null), DECK_LOCAL);
}

function writeBuildPatch(el: Y.Map<unknown>, patch: BuildPatch): void {
  el.set("build", patch.build);
  if (patch.buildAfter) el.set("buildAfter", true);
  else el.delete("buildAfter");
  if (patch.buildDelay) el.set("buildDelay", patch.buildDelay);
  else el.delete("buildDelay");
  if (patch.buildBullets === false) el.set("buildBullets", false);
  if (patch.buildEffect === null) el.delete("buildEffect");
}

export function applyBuildPatches(doc: Y.Doc, slideId: string, patches: Record<string, BuildPatch>): void {
  const slide = slidesMap(doc).get(slideId);
  if (!slide) return;
  doc.transact(() => {
    for (const [id, patch] of Object.entries(patches)) {
      const el = elementsOf(slide).get(id);
      if (el && !isDeleted(el)) writeBuildPatch(el, patch);
    }
  }, DECK_LOCAL);
}

export function setBuildTiming(doc: Y.Doc, slideId: string, id: string, after: boolean, delay: number | null): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el) return;
  doc.transact(() => {
    if (after) el.set("buildAfter", true);
    else el.delete("buildAfter");
    if (after && delay && delay > 0) el.set("buildDelay", Math.min(MAX_BUILD_DELAY, Math.round(delay)));
    else el.delete("buildDelay");
  }, DECK_LOCAL);
}

export function setBuildEffect(doc: Y.Doc, slideId: string, id: string, effect: BuildEffect | null): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get(id);
  if (!el) return;
  doc.transact(() => (effect && BUILD_EFFECTS.includes(effect) ? el.set("buildEffect", effect) : el.delete("buildEffect")), DECK_LOCAL);
}

export function setBuildBullets(doc: Y.Doc, slideId: string, slot: string, on: boolean): void {
  const slide = slidesMap(doc).get(slideId);
  const el = slide && elementsOf(slide).get(slot);
  if (el) doc.transact(() => el.set("buildBullets", on), DECK_LOCAL);
}

export function setSlideSkipped(doc: Y.Doc, ids: string[], skipped: boolean): void {
  doc.transact(() => {
    for (const id of ids) {
      const slide = slidesMap(doc).get(id);
      if (!slide || isDeleted(slide)) continue;
      if (skipped) slide.set("skipped", true);
      else slide.delete("skipped");
    }
  }, DECK_LOCAL);
}

/**
 * Moves several slides, kept in their current order, so they sit together at `index` among the slides left over.
 * Only the moved slides get a new `pos`, spread evenly between their new neighbours.
 */
export function moveSlides(doc: Y.Doc, ids: string[], index: number): void {
  const map = slidesMap(doc);
  const order = visibleSlideIds(doc);
  const moving = order.filter((id) => ids.includes(id));
  if (moving.length === 0) return;
  const others = order.filter((id) => !moving.includes(id));
  const at = Math.max(0, Math.min(index, others.length));
  const pos = (id: string) => Number(map.get(id)!.get("pos"));
  const before = at > 0 ? pos(others[at - 1]) : undefined;
  const after = at < others.length ? pos(others[at]) : undefined;
  doc.transact(() => {
    moving.forEach((id, i) => {
      const k = i + 1;
      const next =
        before !== undefined && after !== undefined ? before + ((after - before) * k) / (moving.length + 1) : before !== undefined ? before + k : after !== undefined ? after - (moving.length + 1 - k) : k;
      map.get(id)!.set("pos", next);
    });
  }, DECK_LOCAL);
}

function setSlideField(doc: Y.Doc, ids: string[], key: string, value: unknown | null): void {
  doc.transact(() => {
    for (const id of ids) {
      const slide = slidesMap(doc).get(id);
      if (!slide || isDeleted(slide)) continue;
      if (value === null) slide.delete(key);
      else slide.set(key, value);
    }
  }, DECK_LOCAL);
}

/** Sets or clears (null) the background of slides. A background that fails validation is ignored. */
export function setSlideBackground(doc: Y.Doc, ids: string[], background: SlideBackground | null): void {
  if (background === null) return setSlideField(doc, ids, "background", null);
  const clean = cleanBackground(background);
  if (clean) setSlideField(doc, ids, "background", clean);
}

export function setSlideTransition(doc: Y.Doc, ids: string[], transition: SlideTransition | null): void {
  const clean = transition === null ? null : cleanTransition(transition);
  setSlideField(doc, ids, "transition", clean);
}

/** Starts, renames (a name) or ends (null) the section that begins at a slide. */
export function setSectionStart(doc: Y.Doc, slideId: string, name: string | null): void {
  const clean = name === null ? null : cleanSection(name);
  if (name !== null && clean === null) return;
  setSlideField(doc, [slideId], "section", clean);
}

/** The slides of the section that begins at `firstId`, in order. */
export function sectionSlideIds(doc: Y.Doc, firstId: string): string[] {
  const rows = visibleSlideIds(doc).map((id) => ({ id, section: cleanSection(slidesMap(doc).get(id)!.get("section")) ?? undefined }));
  return sectionsOf(rows).sections.find((s) => s.firstId === firstId)?.slideIds ?? [];
}

/** Moves a whole section so it starts at `index` among the slides left over. */
export function moveSection(doc: Y.Doc, firstId: string, index: number): void {
  const ids = sectionSlideIds(doc, firstId);
  if (ids.length) moveSlides(doc, ids, index);
}
