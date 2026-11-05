import * as Y from "yjs";
import { blocksToFragment, fragmentToBlocks, plainTextToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { blocksToPlainText } from "~/components/doc/schema/configs";

export const LOCAL_ORIGIN = Symbol("deck-local");

export type SlideMap = Y.Map<unknown>;

export function deckMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("deck");
}

export function slidesMap(doc: Y.Doc): Y.Map<SlideMap> {
  return doc.getMap("slides") as Y.Map<SlideMap>;
}

export function initDeck(doc: Y.Doc, themeId = "dali-dark"): void {
  doc.transact(() => {
    const deck = deckMap(doc);
    deck.set("v", 1);
    deck.set("themeId", themeId);
    deck.set("themeOverrides", new Y.Map());
  }, LOCAL_ORIGIN);
}

export function addSlide(doc: Y.Doc, id: string, pos: number, layoutId = "content"): SlideMap {
  let slide!: SlideMap;
  doc.transact(() => {
    slide = new Y.Map() as SlideMap;
    slidesMap(doc).set(id, slide);
    slide.set("id", id);
    slide.set("pos", pos);
    slide.set("layoutId", layoutId);
    slide.set("deleted", false);
    slide.set("elements", new Y.Map());
    slide.set("text", new Y.Map());
    slide.set("notes", new Y.XmlFragment());
  }, LOCAL_ORIGIN);
  return slide;
}

export function addTextElement(
  doc: Y.Doc,
  slideId: string,
  elId: string,
  geometry = { x: 100, y: 100, w: 800, h: 200 },
  seedText?: string,
): Y.XmlFragment {
  const slide = slidesMap(doc).get(slideId)!;
  let fragment!: Y.XmlFragment;
  doc.transact(() => {
    const el = new Y.Map();
    (slide.get("elements") as Y.Map<Y.Map<unknown>>).set(elId, el);
    el.set("id", elId);
    el.set("kind", "text");
    el.set("z", 1);
    for (const [k, v] of Object.entries(geometry)) el.set(k, v);
    fragment = new Y.XmlFragment();
    (slide.get("text") as Y.Map<Y.XmlFragment>).set(elId, fragment);
    if (seedText) blocksToFragment(plainTextToBlocks(seedText), fragment);
  }, LOCAL_ORIGIN);
  return fragment;
}

export function textFragment(doc: Y.Doc, slideId: string, elId: string): Y.XmlFragment {
  const slide = slidesMap(doc).get(slideId)!;
  return (slide.get("text") as Y.Map<Y.XmlFragment>).get(elId)!;
}

export function moveElement(doc: Y.Doc, slideId: string, elId: string, x: number, y: number, origin: unknown = LOCAL_ORIGIN): void {
  const slide = slidesMap(doc).get(slideId)!;
  const el = (slide.get("elements") as Y.Map<Y.Map<unknown>>).get(elId)!;
  doc.transact(() => {
    el.set("x", x);
    el.set("y", y);
  }, origin);
}

export function tombstoneSlide(doc: Y.Doc, slideId: string, origin: unknown = LOCAL_ORIGIN): void {
  doc.transact(() => slidesMap(doc).get(slideId)!.set("deleted", true), origin);
}

export interface DeckRead {
  v: unknown;
  slides: Array<{
    id: string;
    pos: number;
    layoutId: string;
    elements: Array<{ id: string; kind: string; blocks: DocBlock[]; text: string }>;
    notes: { blocks: DocBlock[]; text: string };
  }>;
  plainText: string;
}

/** Always decodes a clone: y-prosemirror deletes content it cannot decode and Hocuspocus would broadcast it. */
export function readDeck(live: Y.Doc): DeckRead {
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(live));
    const slides: DeckRead["slides"] = [];
    slidesMap(clone).forEach((slide, id) => {
      if (slide.get("deleted") === true) return;
      const textMap = slide.get("text") as Y.Map<Y.XmlFragment>;
      const elements: DeckRead["slides"][number]["elements"] = [];
      (slide.get("elements") as Y.Map<Y.Map<unknown>>).forEach((el, elId) => {
        const frag = textMap.get(elId);
        const blocks = frag ? fragmentToBlocks(frag) : [];
        elements.push({ id: elId, kind: String(el.get("kind")), blocks, text: blocksToPlainText(blocks as never) });
      });
      elements.sort((a, b) => a.id.localeCompare(b.id));
      const notesBlocks = fragmentToBlocks(slide.get("notes") as Y.XmlFragment);
      slides.push({
        id,
        pos: Number(slide.get("pos")),
        layoutId: String(slide.get("layoutId")),
        elements,
        notes: { blocks: notesBlocks, text: blocksToPlainText(notesBlocks as never) },
      });
    });
    slides.sort((a, b) => a.pos - b.pos);
    const plainText = slides
      .flatMap((s) => [...s.elements.map((e) => e.text), s.notes.text])
      .filter(Boolean)
      .join("\n");
    return { v: deckMap(clone).get("v"), slides, plainText };
  } finally {
    clone.destroy();
  }
}

/** Clear the live deck and reapply a snapshot's state in one transaction on the live doc (its own clientID). */
export function restoreDeck(live: Y.Doc, snapshotState: Uint8Array, origin: unknown = "restore"): void {
  const snap = new Y.Doc();
  try {
    Y.applyUpdate(snap, snapshotState);
    live.transact(() => {
      const liveSlides = slidesMap(live);
      for (const key of Array.from(liveSlides.keys())) liveSlides.delete(key);
      const liveDeck = deckMap(live);
      for (const key of Array.from(liveDeck.keys())) liveDeck.delete(key);
      copyMapInto(deckMap(snap), liveDeck);
      copyMapInto(slidesMap(snap), liveSlides);
    }, origin);
  } finally {
    snap.destroy();
  }
}

function copyMapInto(from: Y.Map<unknown>, to: Y.Map<unknown>): void {
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
    f.insert(0, value.toArray().map((n) => n.clone()));
    return f;
  }
  return value;
}
