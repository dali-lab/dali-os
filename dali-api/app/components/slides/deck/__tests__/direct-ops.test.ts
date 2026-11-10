import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { addSlide, deleteSlide, moveSlides, setBuild, setSlideSkipped, visibleSlideIds } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import {
  addFreeImage,
  addShape,
  addTextBox,
  applyStyle,
  deleteElements,
  duplicateElements,
  moveElements,
  pasteItems,
  setAutoHeight,
  setCrop,
  setLocked,
  setPlacements,
} from "../freeform-ops";
import { placementsOf } from "../freeform-ops";
import { cleanStyleClip, styleOf } from "../style-clip";
import { deckMap, elementsOf, initDeck, slidesMap } from "../model";
import { presentable } from "../skip";
import { snapshotDeck, type RenderSlide } from "../snapshot";
import { parseClipboard, serializeSelection } from "../clipboard";
import { parseSlideClipboard, pasteSlides, serializeSlides } from "../slide-clipboard";
import { writeBlocks } from "~/components/slides/pptx/fragment-write";
import { textOf } from "../model";

function setup(layout = "blank") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  return { doc, slideId };
}
const snap = (doc: Y.Doc, slideId: string): RenderSlide => snapshotDeck(doc).slides.find((s) => s.id === slideId)!;
const el = (doc: Y.Doc, slideId: string, id: string) => snap(doc, slideId).elements.find((e) => e.id === id)!;
const undoFor = (doc: Y.Doc) => {
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  return undo;
};

describe("lock", () => {
  it("stores and clears the flag, and the snapshot and the server read both carry it", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    setLocked(doc, slideId, [id], true);
    expect(el(doc, slideId, id).locked).toBe(true);
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === id)!.locked).toBe(true);
    expect(toRenderDeck(readDeck(doc)).slides[0].elements.find((e) => e.id === id)!.locked).toBe(true);
    setLocked(doc, slideId, [id], false);
    expect(el(doc, slideId, id).locked).toBeUndefined();
  });

  it("refuses to move, resize or delete a locked element", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect", { x: 960, y: 540 })!;
    const before = placementsOf(doc, slideId, [id]).get(id)!;
    setLocked(doc, slideId, [id], true);
    setPlacements(doc, slideId, { [id]: { ...before, x: 5, w: 50 } });
    moveElements(doc, slideId, [id], 40, 40);
    expect(deleteElements(doc, slideId, [id])).toEqual([]);
    expect(placementsOf(doc, slideId, [id]).get(id)).toEqual(before);
    expect(el(doc, slideId, id)).toBeDefined();
  });

  it("works again after unlocking", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect", { x: 960, y: 540 })!;
    setLocked(doc, slideId, [id], true);
    setLocked(doc, slideId, [id], false);
    expect(deleteElements(doc, slideId, [id])).toEqual([id]);
  });

  it("does not restyle a locked element", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    setLocked(doc, slideId, [id], true);
    expect(applyStyle(doc, slideId, [id], { kind: "shape", fill: "muted" })).toBe(0);
    expect(el(doc, slideId, id).fill).toBe("accent");
  });

  it("is one undo step", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    const undo = undoFor(doc);
    undo.step(() => setLocked(doc, slideId, [id], true));
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(el(doc, slideId, id).locked).toBeUndefined();
  });
});

describe("crop", () => {
  it("stores a clean crop on an image only, and clears it", () => {
    const { doc, slideId } = setup();
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const shape = addShape(doc, slideId, "rect")!;
    setCrop(doc, slideId, img, { l: 0.1, t: 0, r: 0.2, b: 0 });
    setCrop(doc, slideId, shape, { l: 0.1, t: 0, r: 0.2, b: 0 });
    expect(el(doc, slideId, img).crop).toEqual({ l: 0.1, t: 0, r: 0.2, b: 0 });
    expect(el(doc, slideId, shape).crop).toBeUndefined();
    setCrop(doc, slideId, img, null);
    expect(el(doc, slideId, img).crop).toBeUndefined();
  });

  it("is written together with the geometry by one placement update", () => {
    const { doc, slideId } = setup();
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const placed = placementsOf(doc, slideId, [img]).get(img)!;
    setPlacements(doc, slideId, { [img]: { ...placed, w: 300, crop: { l: 0, t: 0, r: 0.25, b: 0 } } });
    expect(el(doc, slideId, img)).toMatchObject({ w: 300, crop: { l: 0, t: 0, r: 0.25, b: 0 } });
    setPlacements(doc, slideId, { [img]: { ...placed, crop: null } });
    expect(el(doc, slideId, img).crop).toBeUndefined();
  });

  it("survives duplicate and the clipboard, and a hostile crop is cleaned on paste", () => {
    const { doc, slideId } = setup();
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    setCrop(doc, slideId, img, { l: 0.1, t: 0.1, r: 0.1, b: 0.1 });
    const [copy] = duplicateElements(doc, slideId, [img]);
    expect(el(doc, slideId, copy).crop).toEqual({ l: 0.1, t: 0.1, r: 0.1, b: 0.1 });
    const text = serializeSelection(snap(doc, slideId), [img])!;
    const items = parseClipboard(text)!;
    expect(items[0].crop).toEqual({ l: 0.1, t: 0.1, r: 0.1, b: 0.1 });
    const hostile = JSON.parse(text);
    hostile.items[0].crop = { l: 5, t: "x", r: 5, b: 5 };
    const cleaned = parseClipboard(JSON.stringify(hostile))![0].crop!;
    expect(1 - cleaned.l - cleaned.r).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it("reaches the PDF and web render through the snapshot", () => {
    const { doc, slideId } = setup();
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    setCrop(doc, slideId, img, { l: 0.2, t: 0, r: 0, b: 0 });
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === img)!.crop).toEqual({ l: 0.2, t: 0, r: 0, b: 0 });
  });
});

describe("copy and paste style", () => {
  it("reads what a shape or text box carries and nothing from an image", () => {
    const { doc, slideId } = setup();
    const shape = addShape(doc, slideId, "ellipse", undefined, "muted")!;
    const text = addTextBox(doc, slideId)!;
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    expect(styleOf(el(doc, slideId, shape))).toEqual({ kind: "shape", fill: "muted", shape: "ellipse" });
    expect(styleOf(el(doc, slideId, text))).toEqual({ kind: "text" });
    expect(styleOf(el(doc, slideId, img))).toBeNull();
  });

  it("applies fill to shapes, keeps lines as lines, and skips other kinds", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const line = addShape(doc, slideId, "line")!;
    const text = addTextBox(doc, slideId)!;
    const n = applyStyle(doc, slideId, [a, line, text], { kind: "shape", fill: "rule", shape: "ellipse" });
    expect(n).toBe(2);
    expect(el(doc, slideId, a)).toMatchObject({ fill: "rule", shape: "ellipse" });
    expect(el(doc, slideId, line)).toMatchObject({ fill: "rule", shape: "line" });
    expect(el(doc, slideId, text).textStyle).toBeNull();
  });

  it("applies a text style to text boxes only, in one undo step", () => {
    const { doc, slideId } = setup();
    const t = addTextBox(doc, slideId)!;
    const s = addShape(doc, slideId, "rect")!;
    const undo = undoFor(doc);
    undo.step(() => applyStyle(doc, slideId, [t, s], { kind: "text", textStyle: "title" }));
    expect(el(doc, slideId, t).textStyle).toBe("title");
    expect(undo.manager.undoStack).toHaveLength(1);
  });

  it("drops a style clip with unknown values", () => {
    expect(cleanStyleClip({ kind: "shape", fill: "neon", shape: "star" })).toEqual({ kind: "shape" });
    expect(cleanStyleClip({ kind: "image" })).toBeNull();
    expect(cleanStyleClip("x")).toBeNull();
  });
});

describe("auto height", () => {
  it("grows a free text box to the height its text needs, without an undo step", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    const undo = undoFor(doc);
    expect(setAutoHeight(doc, slideId, id, 400)).toBe(true);
    expect(el(doc, slideId, id).h).toBe(400);
    expect(undo.manager.undoStack).toHaveLength(0);
  });

  it("never shrinks and ignores a needed height that already fits", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    expect(setAutoHeight(doc, slideId, id, 100)).toBe(false);
    expect(el(doc, slideId, id).h).toBe(160);
  });

  it("stops once the height was set by hand", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    const placed = placementsOf(doc, slideId, [id]).get(id)!;
    setPlacements(doc, slideId, { [id]: { ...placed, h: 220 } });
    expect(el(doc, slideId, id).hFixed).toBe(true);
    expect(setAutoHeight(doc, slideId, id, 500)).toBe(false);
    expect(el(doc, slideId, id).h).toBe(220);
  });

  it("is not triggered by moving or by resizing only the width", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    const placed = placementsOf(doc, slideId, [id]).get(id)!;
    setPlacements(doc, slideId, { [id]: { ...placed, x: placed.x + 10, w: placed.w - 40 } });
    expect(el(doc, slideId, id).hFixed).toBeUndefined();
    expect(setAutoHeight(doc, slideId, id, 300)).toBe(true);
  });

  it("leaves slot text and locked boxes alone", () => {
    const { doc, slideId } = setup("content");
    expect(setAutoHeight(doc, slideId, "body", 900)).toBe(false);
    const id = addTextBox(doc, slideId)!;
    setLocked(doc, slideId, [id], true);
    expect(setAutoHeight(doc, slideId, id, 500)).toBe(false);
  });

  it("caps runaway heights", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    setAutoHeight(doc, slideId, id, 99_999);
    expect(el(doc, slideId, id).h).toBeLessThanOrEqual(2160);
  });
});

describe("paste at a point", () => {
  it("centres the pasted items on the point and keeps them on the slide", () => {
    const { doc, slideId } = setup();
    const shape = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const items = parseClipboard(serializeSelection(snap(doc, slideId), [shape])!)!;
    const [id] = pasteItems(doc, slideId, items, { at: { x: 1000, y: 600 } });
    const placed = placementsOf(doc, slideId, [id]).get(id)!;
    expect(placed.x + placed.w / 2).toBeCloseTo(1000);
    expect(placed.y + placed.h / 2).toBeCloseTo(600);
    const [edge] = pasteItems(doc, slideId, items, { at: { x: 5, y: 5 } });
    const e = placementsOf(doc, slideId, [edge]).get(edge)!;
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
  });
});

describe("skipping slides", () => {
  it("marks and unmarks slides in one step and the snapshot carries it", () => {
    const { doc, slideId } = setup();
    const other = addSlide(doc, "blank", slideId);
    const undo = undoFor(doc);
    undo.step(() => setSlideSkipped(doc, [slideId, other], true));
    expect(snapshotDeck(doc).slides.every((s) => s.skipped)).toBe(true);
    expect(undo.manager.undoStack).toHaveLength(1);
    expect(readDeck(doc).slides.every((s) => s.skipped)).toBe(true);
    expect(toRenderDeck(readDeck(doc)).slides.every((s) => s.skipped)).toBe(true);
    setSlideSkipped(doc, [slideId], false);
    expect(snapshotDeck(doc).slides[0].skipped).toBeUndefined();
  });

  it("drops skipped slides from what presents and exports, unless that would leave none", () => {
    const slides = [{ id: "a", skipped: true }, { id: "b" }, { id: "c", skipped: true }];
    expect(presentable(slides).map((s) => s.id)).toEqual(["b"]);
    expect(presentable([{ id: "a", skipped: true }]).map((s) => s.id)).toEqual(["a"]);
    expect(presentable([])).toEqual([]);
  });
});

describe("moving several slides", () => {
  const order = (doc: Y.Doc) => visibleSlideIds(doc);
  function deckOf(n: number) {
    const doc = new Y.Doc();
    initDeck(doc);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(addSlide(doc, "blank", ids[i - 1] ?? null));
    return { doc, ids };
  }
  const pos = (doc: Y.Doc, id: string) => Number(slidesMap(doc).get(id)!.get("pos"));

  it("lands them together, in their old order, between the new neighbours", () => {
    const { doc, ids } = deckOf(6);
    moveSlides(doc, [ids[3], ids[1]], 4);
    expect(order(doc)).toEqual([ids[0], ids[2], ids[4], ids[5], ids[1], ids[3]]);
  });

  it("moves to the top and to the bottom", () => {
    const { doc, ids } = deckOf(4);
    moveSlides(doc, [ids[2], ids[3]], 0);
    expect(order(doc)).toEqual([ids[2], ids[3], ids[0], ids[1]]);
    moveSlides(doc, [ids[2]], 99);
    expect(order(doc)).toEqual([ids[3], ids[0], ids[1], ids[2]]);
  });

  it("writes a new pos only for the moved slides, in one undo step", () => {
    const { doc, ids } = deckOf(5);
    const before = ids.map((id) => pos(doc, id));
    const undo = undoFor(doc);
    undo.step(() => moveSlides(doc, [ids[0], ids[1]], 3));
    const after = ids.map((id) => pos(doc, id));
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after[0]).not.toBe(before[0]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(order(doc)).toEqual(ids);
  });

  it("ignores ids that are not slides or are deleted", () => {
    const { doc, ids } = deckOf(3);
    deleteSlide(doc, ids[1]);
    moveSlides(doc, ["ghost", ids[1]], 0);
    expect(order(doc)).toEqual([ids[0], ids[2]]);
  });
});

describe("copying slides across decks", () => {
  function sourceDeck() {
    const { doc, slideId } = setup("content");
    const slide = slidesMap(doc).get(slideId)!;
    writeBlocks(textOf(slide).get("title")!, [{ type: "paragraph", content: [{ type: "text", text: "Hello", styles: { bold: true } }], children: [] }]);
    elementsOf(slide).get("title")!.set("textStyle", "title");
    addShape(doc, slideId, "ellipse", { x: 500, y: 400 }, "muted");
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    setCrop(doc, slideId, img, { l: 0.1, t: 0, r: 0, b: 0 });
    setSlideSkipped(doc, [slideId], true);
    return { doc, slideId };
  }

  it("round-trips layout, slot text, free elements, crop and skipped into another deck", () => {
    const src = sourceDeck();
    const text = serializeSlides([snap(src.doc, src.slideId)])!;
    const target = new Y.Doc();
    initDeck(target);
    const first = addSlide(target, "blank", null);
    const [created] = pasteSlides(target, parseSlideClipboard(text)!, first);
    expect(visibleSlideIds(target)).toEqual([first, created]);
    const pasted = readDeck(target).slides.find((s) => s.id === created)!;
    expect(pasted.layoutId).toBe("content");
    expect(pasted.skipped).toBe(true);
    expect(pasted.elements.find((e) => e.slot === "title")).toMatchObject({ text: "Hello", textStyle: "title" });
    expect(pasted.elements.find((e) => e.shape === "ellipse")).toMatchObject({ fill: "muted" });
    expect(pasted.elements.find((e) => e.kind === "image" && !e.slot)).toMatchObject({ src: "https://x/y.png", crop: { l: 0.1, t: 0, r: 0, b: 0 } });
  });

  it("pastes several slides in order after the target, as one undo step", () => {
    const src = sourceDeck();
    const two = serializeSlides([snap(src.doc, src.slideId), snap(src.doc, src.slideId)])!;
    const { doc, slideId } = setup();
    const after = addSlide(doc, "blank", slideId);
    const undo = undoFor(doc);
    const created = undo.step(() => pasteSlides(doc, parseSlideClipboard(two)!, slideId));
    expect(visibleSlideIds(doc)).toEqual([slideId, created[0], created[1], after]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(visibleSlideIds(doc)).toEqual([slideId, after]);
  });

  it("rejects text that is not ours and sanitizes what is", () => {
    expect(parseSlideClipboard("hello")).toBeNull();
    expect(parseSlideClipboard(JSON.stringify({ mark: "other", v: 1, slides: [] }))).toBeNull();
    expect(parseSlideClipboard("{not json")).toBeNull();
    const hostile = JSON.stringify({
      mark: "dali-slides-slides",
      v: 1,
      slides: [
        {
          layoutId: "../../etc",
          slots: [
            { slot: "image", src: "javascript:alert(1)", alt: "x" },
            { slot: "nope", blocks: [] },
            { slot: "title", blocks: [{ type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "hi", styles: {} }] }] }], placed: { x: 1e9, y: 0, w: -3, h: 5 } },
          ],
          items: [{ key: "a", kind: "image", src: "data:text/html,x", placed: { x: 0, y: 0, w: 10, h: 10 } }],
        },
      ],
    });
    const clips = parseSlideClipboard(hostile)!;
    expect(clips).toHaveLength(1);
    expect(clips[0].layoutId).not.toContain("etc");
    expect(clips[0].items).toEqual([]);
    expect(clips[0].slots.find((s) => s.slot === "nope")).toBeUndefined();
    expect(clips[0].slots.find((s) => s.slot === "title")!.placed).toBeUndefined();
    const doc = new Y.Doc();
    initDeck(doc);
    const [id] = pasteSlides(doc, clips, null);
    const title = readDeck(doc).slides.find((s) => s.id === id)!.elements.find((e) => e.slot === "title");
    expect(JSON.stringify(title?.blocks)).not.toContain("javascript:");
  });

  it("returns null for nothing to copy", () => {
    expect(serializeSlides([])).toBeNull();
  });
});

describe("builds on any element", () => {
  it("adds and clears a build step", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    setBuild(doc, slideId, id, 1);
    expect(el(doc, slideId, id).build).toBe(1);
    setBuild(doc, slideId, id, null);
    expect(el(doc, slideId, id).build).toBeUndefined();
  });
});
