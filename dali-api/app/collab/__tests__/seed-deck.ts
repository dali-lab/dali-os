import * as Y from "yjs";
import { blocksToFragment, plainTextToBlocks, type DocBlock } from "../blocknote-server";
import { readDeck, type DeckRead } from "../read-deck.server";
import { ensureLayoutSlots } from "~/components/slides/deck/deck-ops";
import {
  between,
  elementsOf,
  initDeck,
  newElementMap,
  newSlideMap,
  notesOf,
  slidesMap,
  textOf,
} from "~/components/slides/deck/model";

export interface SeedSlide {
  id: string;
  layout: string;
  title?: string;
  subtitle?: string;
  body?: DocBlock[];
  image?: { src: string; alt: string };
  notes?: string;
}

const Z = { title: 1, subtitle: 2, body: 3, image: 4 };

function writeText(doc: Y.Doc, slideId: string, slot: "title" | "subtitle" | "body", blocks: DocBlock[]): void {
  const slide = slidesMap(doc).get(slideId)!;
  let frag = textOf(slide).get(slot);
  if (!frag) {
    frag = new Y.XmlFragment();
    textOf(slide).set(slot, frag);
  }
  if (!elementsOf(slide).get(slot)) elementsOf(slide).set(slot, newElementMap(slot, "text", Z[slot], { slot }));
  blocksToFragment(blocks, frag);
}

/** A live deck with the given slides, in order. Boxes the layout doesn't draw are left off. */
export function seedDeck(doc: Y.Doc, slides: SeedSlide[]): void {
  doc.transact(() => {
    initDeck(doc);
    let prev: number | undefined;
    for (const s of slides) {
      const pos = between(prev, undefined);
      slidesMap(doc).set(s.id, newSlideMap(s.id, pos, s.layout));
      prev = pos;
      if (s.title) writeText(doc, s.id, "title", plainTextToBlocks(s.title));
      if (s.subtitle) writeText(doc, s.id, "subtitle", plainTextToBlocks(s.subtitle));
      if (s.body?.length) writeText(doc, s.id, "body", s.body);
      const slide = slidesMap(doc).get(s.id)!;
      if (s.image) elementsOf(slide).set("image", newElementMap("image", "image", Z.image, { slot: "image", src: s.image.src, alt: s.image.alt }));
      if (s.notes) blocksToFragment(plainTextToBlocks(s.notes), notesOf(slide));
      ensureLayoutSlots(slide, s.layout);
    }
  });
}

export const seededDeck = (slides: SeedSlide[]): Y.Doc => {
  const doc = new Y.Doc();
  seedDeck(doc, slides);
  return doc;
};

export const slotText = (read: DeckRead, slideId: string, slot: string): string | undefined =>
  read.slides.find((s) => s.id === slideId)?.elements.find((e) => e.slot === slot)?.text;

export const deckTitles = (doc: Y.Doc): string[] => readDeck(doc).slides.map((s) => s.elements.find((e) => e.slot === "title")?.text ?? "");
