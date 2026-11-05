import * as Y from "yjs";
import { fragmentToBlocks, type DocBlock } from "./blocknote-server";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import {
  compareZ,
  comparePos,
  deckVersionOf,
  elementsOf,
  isDeleted,
  notesOf,
  slidesMap,
  textOf,
} from "~/components/slides/deck/model";
import type { Slide, SlideLayout } from "~/components/slides/types";

export interface DeckReadElement {
  id: string;
  kind: string;
  slot: string | null;
  z: number;
  src: string | null;
  alt: string | null;
  blocks: DocBlock[];
  text: string;
}

export interface DeckReadSlide {
  id: string;
  pos: number;
  layoutId: string;
  elements: DeckReadElement[];
  notes: { blocks: DocBlock[]; text: string };
}

export interface DeckRead {
  v: unknown;
  slides: DeckReadSlide[];
  plainText: string;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Decodes a clone: y-prosemirror deletes what it can't decode, and on the live doc Hocuspocus would broadcast that deletion. */
export function readDeck(live: Y.Doc): DeckRead {
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(live));
    const slides: DeckReadSlide[] = [];
    slidesMap(clone).forEach((slide, id) => {
      if (isDeleted(slide)) return;
      const fragments = textOf(slide);
      const elements: DeckReadElement[] = [];
      elementsOf(slide).forEach((el, elId) => {
        if (isDeleted(el)) return;
        const frag = fragments.get(elId);
        const blocks = frag ? fragmentToBlocks(frag) : [];
        elements.push({
          id: elId,
          kind: String(el.get("kind")),
          slot: str(el.get("slot")),
          z: Number(el.get("z") ?? 0),
          src: str(el.get("src")),
          alt: str(el.get("alt")),
          blocks,
          text: blocksToPlainText(blocks as never),
        });
      });
      elements.sort(compareZ);
      const notesBlocks = fragmentToBlocks(notesOf(slide));
      slides.push({
        id,
        pos: Number(slide.get("pos")),
        layoutId: String(slide.get("layoutId")),
        elements,
        notes: { blocks: notesBlocks, text: blocksToPlainText(notesBlocks as never) },
      });
    });
    slides.sort(comparePos);
    const plainText = slides
      .flatMap((s) => [...s.elements.map((e) => e.text), s.notes.text])
      .filter(Boolean)
      .join("\n");
    return { v: deckVersionOf(clone), slides, plainText };
  } finally {
    clone.destroy();
  }
}

const LEGACY_LAYOUTS: readonly SlideLayout[] = ["title", "content", "split", "image"];

export function legacyLayout(layoutId: string): SlideLayout {
  return (LEGACY_LAYOUTS as readonly string[]).includes(layoutId) ? (layoutId as SlideLayout) : "content";
}

/** The legacy Slide[] shape of a deck, for readers that predate the Yjs model. Freeform (slotless) elements are dropped. */
export function projectLegacySlides(read: DeckRead): Slide[] {
  return read.slides.map((s) => {
    const slot = (name: string) => s.elements.find((e) => e.slot === name);
    const image = slot("image");
    const body = slot("body");
    const subtitle = slot("subtitle");
    const slide: Slide = {
      id: s.id,
      layout: legacyLayout(s.layoutId),
      title: slot("title")?.text ?? "",
    };
    if (subtitle?.text) slide.subtitle = subtitle.text;
    if (body && body.blocks.length > 0) slide.body = body.blocks as never;
    if (image?.src) slide.image = { src: image.src, alt: image.alt ?? "" };
    if (s.notes.text) slide.notes = s.notes.text;
    return slide;
  });
}
