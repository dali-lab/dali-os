import * as Y from "yjs";

export const DECK_VERSION = 1;
export const DEFAULT_THEME_ID = "dali-dark";

export type ElementKind = "text" | "image" | "shape" | "embed";

export type ElementMap = Y.Map<unknown>;
export type SlideMap = Y.Map<unknown>;

export function deckMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("deck");
}

export function slidesMap(doc: Y.Doc): Y.Map<SlideMap> {
  return doc.getMap("slides") as Y.Map<SlideMap>;
}

export function elementsOf(slide: SlideMap): Y.Map<ElementMap> {
  return slide.get("elements") as Y.Map<ElementMap>;
}

export function textOf(slide: SlideMap): Y.Map<Y.XmlFragment> {
  return slide.get("text") as Y.Map<Y.XmlFragment>;
}

export function notesOf(slide: SlideMap): Y.XmlFragment {
  return slide.get("notes") as Y.XmlFragment;
}

export function isDeleted(map: Y.Map<unknown>): boolean {
  return map.get("deleted") === true;
}

export type DeckAccessMode = "edit" | "readonly";

export function deckAccessMode(v: unknown): DeckAccessMode {
  return v === DECK_VERSION ? "edit" : "readonly";
}

export function deckVersionOf(doc: Y.Doc): unknown {
  return deckMap(doc).get("v");
}

export function restoreEpochOf(doc: Y.Doc): number {
  const epoch = deckMap(doc).get("restoreEpoch");
  return typeof epoch === "number" ? epoch : 0;
}

export function initDeck(doc: Y.Doc, themeId = DEFAULT_THEME_ID): void {
  const deck = deckMap(doc);
  deck.set("v", DECK_VERSION);
  deck.set("themeId", themeId);
  deck.set("themeOverrides", new Y.Map());
  deck.set("restoreEpoch", 0);
}

export function newSlideMap(id: string, pos: number, layoutId: string): SlideMap {
  const slide = new Y.Map<unknown>();
  slide.set("id", id);
  slide.set("pos", pos);
  slide.set("layoutId", layoutId);
  slide.set("deleted", false);
  slide.set("elements", new Y.Map());
  slide.set("text", new Y.Map());
  slide.set("notes", new Y.XmlFragment());
  return slide;
}

export function newElementMap(id: string, kind: ElementKind, z: number, fields: Record<string, unknown> = {}): ElementMap {
  const el = new Y.Map<unknown>();
  el.set("id", id);
  el.set("kind", kind);
  el.set("z", z);
  el.set("deleted", false);
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  return el;
}

export function tombstoneSlide(slide: SlideMap): void {
  slide.set("deleted", true);
}

export function tombstoneElement(el: ElementMap): void {
  el.set("deleted", true);
}

export function restoreSlide(slide: SlideMap): void {
  slide.set("deleted", false);
}

/** A position strictly between `before` and `after`; either may be absent for the ends. */
export function between(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export function comparePos(a: { pos: number; id: string }, b: { pos: number; id: string }): number {
  return a.pos - b.pos || a.id.localeCompare(b.id);
}

export function compareZ(a: { z: number; id: string }, b: { z: number; id: string }): number {
  return a.z - b.z || a.id.localeCompare(b.id);
}
