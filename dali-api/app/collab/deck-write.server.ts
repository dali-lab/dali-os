import * as Y from "yjs";
import { blocksToFragment, plainTextToBlocks, type DocBlock } from "./blocknote-server";
import { legacyLayout, projectLegacySlides, readDeck } from "./read-deck.server";
import {
  between,
  deckMap,
  elementsOf,
  initDeck,
  isDeleted,
  newElementMap,
  newSlideMap,
  notesOf,
  restoreEpochOf,
  slidesMap,
  textOf,
  tombstoneElement,
  tombstoneSlide,
  type SlideMap,
} from "~/components/slides/deck/model";
import type { Slide } from "~/components/slides/types";

export const LOCAL_ORIGIN = Symbol("deck-local");

const TEXT_SLOTS = [
  { slot: "title", z: 1 },
  { slot: "subtitle", z: 2 },
  { slot: "body", z: 3 },
] as const;
const IMAGE_Z = 4;

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => [k, stripIds(v)]),
    );
  }
  return value;
}

const sameBlocks = (a: unknown, b: unknown) => JSON.stringify(stripIds(a ?? [])) === JSON.stringify(stripIds(b ?? []));

function slotBlocks(slide: Slide, slot: (typeof TEXT_SLOTS)[number]["slot"]): DocBlock[] | null {
  if (slot === "title") return slide.title ? plainTextToBlocks(slide.title) : null;
  if (slot === "subtitle") return slide.subtitle ? plainTextToBlocks(slide.subtitle) : null;
  return slide.body && slide.body.length > 0 ? (slide.body as unknown as DocBlock[]) : null;
}

function writeTextSlot(slide: SlideMap, slot: string, z: number, blocks: DocBlock[] | null): void {
  const elements = elementsOf(slide);
  const existing = elements.get(slot);
  if (!blocks) {
    if (existing && !isDeleted(existing)) tombstoneElement(existing);
    return;
  }
  let frag = textOf(slide).get(slot);
  if (!frag) {
    frag = new Y.XmlFragment();
    textOf(slide).set(slot, frag);
  }
  if (!existing) elements.set(slot, newElementMap(slot, "text", z, { slot }));
  else if (isDeleted(existing)) existing.set("deleted", false);
  blocksToFragment(blocks, frag);
}

function writeImageSlot(slide: SlideMap, image: Slide["image"]): void {
  const elements = elementsOf(slide);
  const existing = elements.get("image");
  if (!image) {
    if (existing && !isDeleted(existing)) tombstoneElement(existing);
    return;
  }
  if (!existing) {
    elements.set("image", newElementMap("image", "image", IMAGE_Z, { slot: "image", src: image.src, alt: image.alt }));
    return;
  }
  existing.set("deleted", false);
  existing.set("src", image.src);
  existing.set("alt", image.alt);
}

function writeNotes(slide: SlideMap, notes: string | undefined): void {
  const frag = notesOf(slide);
  if (notes) blocksToFragment(plainTextToBlocks(notes), frag);
  else if (frag.length > 0) frag.delete(0, frag.length);
}

function applySlide(slide: SlideMap, target: Slide, current: Slide | undefined): void {
  if (legacyLayout(String(slide.get("layoutId"))) !== target.layout) slide.set("layoutId", target.layout);
  const changed = {
    title: !current || current.title !== target.title,
    subtitle: !current || (current.subtitle ?? "") !== (target.subtitle ?? ""),
    body: !current || !sameBlocks(current.body, target.body),
  };
  for (const { slot, z } of TEXT_SLOTS) {
    if (changed[slot]) writeTextSlot(slide, slot, z, slotBlocks(target, slot));
  }
  if (!current || JSON.stringify(current.image ?? null) !== JSON.stringify(target.image ?? null)) writeImageSlot(slide, target.image);
  if (!current || (current.notes ?? "") !== (target.notes ?? "")) writeNotes(slide, target.notes);
}

/**
 * Makes the live deck match `target`, in the target's order. Slides missing from `target` are tombstoned,
 * and only the parts of a slide that differ are rewritten, so a peer's unrelated edits survive.
 */
export function applySlides(doc: Y.Doc, target: Slide[]): void {
  doc.transact(() => {
    const current = new Map(projectLegacySlides(readDeck(doc)).map((s) => [s.id, s]));
    const map = slidesMap(doc);
    const keep = new Set(target.map((s) => s.id));
    map.forEach((slide, id) => {
      if (!keep.has(id) && !isDeleted(slide)) tombstoneSlide(slide);
    });

    const existingPos = (id: string): number | undefined => {
      const slide = map.get(id);
      return slide && !isDeleted(slide) ? Number(slide.get("pos")) : undefined;
    };
    let prev: number | undefined;
    target.forEach((s, i) => {
      let slide = map.get(s.id);
      const pos = existingPos(s.id);
      if (!slide) {
        slide = newSlideMap(s.id, 0, s.layout);
        map.set(s.id, slide);
      } else if (isDeleted(slide)) {
        slide.set("deleted", false);
      }
      if (pos === undefined || (prev !== undefined && pos <= prev)) {
        let next: number | undefined;
        for (const later of target.slice(i + 1)) {
          const p = existingPos(later.id);
          if (p !== undefined && (prev === undefined || p > prev)) {
            next = p;
            break;
          }
        }
        slide.set("pos", between(prev, next));
      }
      prev = Number(slide.get("pos"));
      applySlide(slide, s, current.get(s.id));
    });
  }, LOCAL_ORIGIN);
}

export function seedDeckDoc(doc: Y.Doc, slides: Slide[]): void {
  doc.transact(() => {
    initDeck(doc);
    applySlides(doc, slides);
  }, LOCAL_ORIGIN);
}

function copyInto(from: Y.Map<unknown>, to: Y.Map<unknown>): void {
  from.forEach((value, key) => to.set(key, cloneValue(value)));
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

/**
 * Clears the live deck and reapplies a snapshot in one transaction on the live doc, so it keeps its own clientID.
 * Old fragments are dropped, so editors must remount when `deck.restoreEpoch` changes.
 */
export function restoreDeck(live: Y.Doc, snapshotState: Uint8Array, origin: unknown = "restore"): void {
  const snap = new Y.Doc();
  try {
    Y.applyUpdate(snap, snapshotState);
    live.transact(() => {
      const epoch = restoreEpochOf(live) + 1;
      const liveSlides = slidesMap(live);
      for (const key of Array.from(liveSlides.keys())) liveSlides.delete(key);
      const liveDeck = deckMap(live);
      for (const key of Array.from(liveDeck.keys())) liveDeck.delete(key);
      copyInto(deckMap(snap), liveDeck);
      copyInto(slidesMap(snap) as Y.Map<unknown>, liveSlides as Y.Map<unknown>);
      liveDeck.set("restoreEpoch", epoch);
    }, origin);
  } finally {
    snap.destroy();
  }
}
