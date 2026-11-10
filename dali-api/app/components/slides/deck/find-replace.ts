import * as Y from "yjs";
import { DECK_LOCAL } from "./deck-ops";
import { compareZ, elementsOf, isDeleted, notesOf, slidesMap, textOf, comparePos } from "./model";

const EMBED = "￼";

export interface FindOptions {
  matchCase?: boolean;
}

export interface FindMatch {
  slideId: string;
  /** The element or slot the text lives in, or null for the slide's speaker notes. */
  key: string | null;
  node: Y.XmlText;
  index: number;
  length: number;
}

function textNodes(parent: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) textNodes(child, out);
  }
  return out;
}

export function plainOf(node: Y.XmlText): string {
  return (node.toDelta() as Array<{ insert: unknown }>).map((op) => (typeof op.insert === "string" ? op.insert : EMBED)).join("");
}

function attributesAt(node: Y.XmlText, index: number): Record<string, unknown> | undefined {
  let at = 0;
  for (const op of node.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>) {
    const length = typeof op.insert === "string" ? op.insert.length : 1;
    if (index < at + length) return op.attributes;
    at += length;
  }
  return undefined;
}

function occurrences(haystack: string, needle: string, matchCase: boolean): number[] {
  const source = matchCase ? haystack : haystack.toLowerCase();
  const target = matchCase ? needle : needle.toLowerCase();
  const found: number[] = [];
  for (let from = source.indexOf(target); from !== -1; from = source.indexOf(target, from + target.length)) found.push(from);
  return found;
}

/** Every match in slide order: each slide's text boxes by stacking order, then its speaker notes. */
export function findMatches(doc: Y.Doc, query: string, { matchCase = false }: FindOptions = {}): FindMatch[] {
  if (query === "") return [];
  const slides: Array<{ id: string; pos: number; map: Y.Map<unknown> }> = [];
  slidesMap(doc).forEach((slide, id) => {
    if (!isDeleted(slide)) slides.push({ id, pos: Number(slide.get("pos") ?? 0), map: slide });
  });
  slides.sort(comparePos);
  const out: FindMatch[] = [];
  const scan = (slideId: string, key: string | null, fragment: Y.XmlFragment | undefined) => {
    if (!fragment) return;
    for (const node of textNodes(fragment)) {
      for (const index of occurrences(plainOf(node), query, matchCase)) out.push({ slideId, key, node, index, length: query.length });
    }
  };
  for (const { id, map } of slides) {
    const fragments = textOf(map);
    const keys: Array<{ key: string; z: number }> = [];
    elementsOf(map).forEach((el, key) => {
      if (!isDeleted(el) && fragments.get(key)) keys.push({ key, z: Number(el.get("z") ?? 0) });
    });
    keys.sort((a, b) => compareZ({ z: a.z, id: a.key }, { z: b.z, id: b.key }));
    for (const { key } of keys) scan(id, key, fragments.get(key));
    scan(id, null, notesOf(map));
  }
  return out;
}

/** Replaces the matches in one transaction, so a single undo reverts all of them. Edits text runs in place and keeps each match's formatting. */
export function replaceMatches(doc: Y.Doc, matches: FindMatch[], replacement: string): number {
  if (matches.length === 0) return 0;
  const byNode = new Map<Y.XmlText, FindMatch[]>();
  for (const m of matches) byNode.set(m.node, [...(byNode.get(m.node) ?? []), m]);
  doc.transact(() => {
    for (const [node, list] of byNode) {
      for (const m of [...list].sort((a, b) => b.index - a.index)) {
        const attributes = attributesAt(node, m.index);
        node.delete(m.index, m.length);
        if (replacement) node.insert(m.index, replacement, attributes);
      }
    }
  }, DECK_LOCAL);
  return matches.length;
}
