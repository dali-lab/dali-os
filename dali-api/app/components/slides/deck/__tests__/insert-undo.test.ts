import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { readDeck } from "~/collab/read-deck.server";
import { parseClipboard, serializeSelection } from "../clipboard";
import { addSlide, duplicateSlide, slideFragment, visibleSlideIds } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import {
  addChart,
  addCodeBlock,
  addEmoji,
  addFreeImage,
  addIcon,
  addShape,
  addTable,
  addTextBox,
  addVideo,
  duplicateElements,
  pasteItems,
} from "../freeform-ops";
import { deckMap, elementsOf, initDeck, slidesMap, textOf } from "../model";
import { snapshotDeck, type RenderSlide } from "../snapshot";
import { parseSlideClipboard, pasteSlides, serializeSlides } from "../slide-clipboard";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  return { doc, slideId, undo };
}
const slideOf = (doc: Y.Doc, id: string): RenderSlide => snapshotDeck(doc).slides.find((s) => s.id === id)!;
const rawEl = (doc: Y.Doc, slideId: string, id: string) => elementsOf(slidesMap(doc).get(slideId)!).get(id);

type Insert = (doc: Y.Doc, slideId: string) => string | string[] | null;
const KINDS: Array<[string, Insert]> = [
  ["text box", (d, s) => addTextBox(d, s)],
  ["table", (d, s) => addTable(d, s)],
  ["code block", (d, s) => addCodeBlock(d, s)],
  ["emoji", (d, s) => addEmoji(d, s, "🚀")],
  ["chart", (d, s) => addChart(d, s, "pie")],
  ["icon", (d, s) => addIcon(d, s, "star")],
  ["video", (d, s) => addVideo(d, s, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")],
  ["shape", (d, s) => addShape(d, s, "ellipse")],
  ["image", (d, s) => addFreeImage(d, s, "https://x/y.png", "y")],
];

describe.each(KINDS)("inserting a %s", (_name, insert) => {
  it("is one undo step: undo tombstones it, redo restores it, and the entry is never removed", () => {
    const { doc, slideId, undo } = setup();
    const id = undo.step(() => insert(doc, slideId)) as string;
    expect(slideOf(doc, slideId).elements.map((e) => e.id)).toEqual([id]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(slideOf(doc, slideId).elements).toHaveLength(0);
    expect(rawEl(doc, slideId, id)).toBeDefined();
    expect(rawEl(doc, slideId, id)!.get("deleted")).toBe(true);
    undo.manager.redo();
    expect(slideOf(doc, slideId).elements.map((e) => e.id)).toEqual([id]);
    expect(rawEl(doc, slideId, id)!.get("deleted")).toBe(false);
  });
});

describe("duplicate and paste of elements", () => {
  it("duplicates several elements in one undoable step", () => {
    const { doc, slideId, undo } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addTextBox(doc, slideId)!;
    undo.manager.clear();
    const copies = undo.step(() => duplicateElements(doc, slideId, [a, b]));
    expect(copies).toHaveLength(2);
    expect(slideOf(doc, slideId).elements).toHaveLength(4);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(slideOf(doc, slideId).elements.map((e) => e.id).sort()).toEqual([a, b].sort());
    expect(textOf(slidesMap(doc).get(slideId)!).has(copies[1]) || textOf(slidesMap(doc).get(slideId)!).has(copies[0])).toBe(true);
    undo.manager.redo();
    expect(slideOf(doc, slideId).elements).toHaveLength(4);
  });

  it("pastes several elements, groups included, in one undoable step", () => {
    const { doc, slideId, undo } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const c = addTextBox(doc, slideId)!;
    const items = parseClipboard(serializeSelection(slideOf(doc, slideId), [a, b, c])!)!;
    undo.manager.clear();
    undo.step(() => pasteItems(doc, slideId, items));
    expect(slideOf(doc, slideId).elements).toHaveLength(6);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(slideOf(doc, slideId).elements).toHaveLength(3);
    undo.manager.redo();
    expect(slideOf(doc, slideId).elements).toHaveLength(6);
  });

  it("tombstones a copied group together with its children", () => {
    const { doc, slideId, undo } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const slide = slidesMap(doc).get(slideId)!;
    const gid = "g1";
    doc.transact(() => elementsOf(slide).set(gid, (() => { const m = new Y.Map<unknown>(); m.set("id", gid); m.set("kind", "group"); m.set("z", 9); m.set("deleted", false); m.set("children", [a, b]); return m; })()));
    undo.manager.clear();
    undo.step(() => duplicateElements(doc, slideId, [gid]));
    expect(slideOf(doc, slideId).elements.filter((e) => e.kind === "group")).toHaveLength(2);
    undo.manager.undo();
    expect(slideOf(doc, slideId).elements.filter((e) => e.kind === "group")).toHaveLength(1);
    expect(slideOf(doc, slideId).elements).toHaveLength(3);
  });
});

describe("slides", () => {
  it("a new slide is one step: undo tombstones it, redo restores it, and it is never removed", () => {
    const { doc, slideId, undo } = setup();
    const id = undo.step(() => addSlide(doc, "content", slideId));
    expect(visibleSlideIds(doc)).toEqual([slideId, id]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).toEqual([slideId]);
    expect(snapshotDeck(doc).deletedIds).toContain(id);
    expect(snapshotDeck(doc).deletedBy[id]).toBeNull();
    expect(slidesMap(doc).has(id)).toBe(true);
    undo.manager.redo();
    expect(visibleSlideIds(doc)).toEqual([slideId, id]);
    expect(slideOf(doc, id).elements.length).toBeGreaterThan(0);
  });

  it("an undone slide is gone from reads and exports, and back after redo", () => {
    const { doc, slideId, undo } = setup();
    const id = undo.step(() => addSlide(doc, "content", slideId));
    undo.manager.undo();
    expect(readDeck(doc).slides.map((s) => s.id)).toEqual([slideId]);
    undo.manager.redo();
    expect(readDeck(doc).slides.map((s) => s.id)).toEqual([slideId, id]);
  });

  it("a duplicated slide is one step and keeps its content through undo and redo", () => {
    const { doc, undo } = setup();
    const src = addSlide(doc, "content", null);
    blocksToFragment([{ type: "paragraph", content: "kept" }] as never, slideFragment(doc, src, "title")!);
    undo.manager.clear();
    const copy = undo.step(() => duplicateSlide(doc, src)!);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).not.toContain(copy);
    undo.manager.redo();
    expect(readDeck(doc).slides.find((s) => s.id === copy)!.elements.find((e) => e.slot === "title")!.text).toBe("kept");
  });

  it("pasting several slides is one step", () => {
    const { doc, slideId, undo } = setup();
    const clips = parseSlideClipboard(serializeSlides([slideOf(doc, slideId), slideOf(doc, slideId)])!)!;
    const ids = undo.step(() => pasteSlides(doc, clips, slideId));
    expect(visibleSlideIds(doc)).toEqual([slideId, ...ids]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).toEqual([slideId]);
    undo.manager.redo();
    expect(visibleSlideIds(doc)).toEqual([slideId, ...ids]);
  });

  it("slides inserted after an undone one still land in order", () => {
    const { doc, slideId, undo } = setup();
    const first = undo.step(() => addSlide(doc, "content", slideId));
    undo.manager.undo();
    const second = undo.step(() => addSlide(doc, "content", slideId));
    expect(visibleSlideIds(doc)).toEqual([slideId, second]);
    expect(first).not.toBe(second);
  });
});

describe("a peer typing into an inserted element", () => {
  function pair() {
    const a = setup();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(a.doc));
    const relay = () => {
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(peer)), "remote");
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(a.doc)), "remote");
    };
    return { ...a, peer, relay };
  }
  const textOfEl = (doc: Y.Doc, slideId: string, id: string) => readDeck(doc).slides.find((s) => s.id === slideId)!.elements.find((e) => e.id === id)?.text;

  it("keeps the peer's text through undo and redo of a new text box", () => {
    const { doc, slideId, undo, peer, relay } = pair();
    const id = undo.step(() => addTextBox(doc, slideId))!;
    relay();
    blocksToFragment([{ type: "paragraph", content: "peer words" }] as never, slideFragment(peer, slideId, id)!);
    relay();
    expect(textOfEl(doc, slideId, id)).toBe("peer words");
    undo.manager.undo();
    relay();
    expect(textOfEl(doc, slideId, id)).toBeUndefined();
    expect(slideFragment(peer, slideId, id)).toBeTruthy();
    expect(slideFragment(doc, slideId, id)!.length).toBeGreaterThan(0);
    undo.manager.redo();
    relay();
    expect(textOfEl(doc, slideId, id)).toBe("peer words");
    expect(textOfEl(peer, slideId, id)).toBe("peer words");
  });

  it("keeps the peer's text through undo and redo of a new slide", () => {
    const { doc, slideId, undo, peer, relay } = pair();
    const id = undo.step(() => addSlide(doc, "content", slideId));
    relay();
    blocksToFragment([{ type: "paragraph", content: "peer title" }] as never, slideFragment(peer, id, "title")!);
    relay();
    undo.manager.undo();
    relay();
    expect(visibleSlideIds(peer)).toEqual([slideId]);
    undo.manager.redo();
    relay();
    expect(textOfEl(doc, id, "title")).toBe("peer title");
    expect(visibleSlideIds(peer)).toEqual([slideId, id]);
  });
});

