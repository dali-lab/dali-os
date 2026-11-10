import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { deckMissingSlots, readDeck } from "~/collab/read-deck.server";
import { addSlide, duplicateSlide, repairDeckSlots, setLayout, setSlotImage, slideFragment, slideMissingSlot } from "../deck-ops";
import {
  addFreeImage,
  addShape,
  addTextBox,
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  moveElements,
  pasteItems,
  placementsOf,
  reorderElements,
  setFill,
  setImageSource,
  setPlacements,
  snapBack,
  ungroupElements,
} from "../freeform-ops";
import { explicitPlacement, isDetached, isFreeRendered, placedElements, placementOf } from "../freeform";
import { elementsOf, initDeck, isDeleted, slidesMap, textOf } from "../model";
import { snapshotDeck, snapshotSlide, type RenderSlide } from "../snapshot";

function setup(layout = "content") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  return { doc, slideId };
}
const snap = (doc: Y.Doc, slideId: string): RenderSlide => snapshotDeck(doc).slides.find((s) => s.id === slideId)!;
const el = (doc: Y.Doc, slideId: string, id: string) => snap(doc, slideId).elements.find((e) => e.id === id)!;
const raw = (doc: Y.Doc, slideId: string, id: string) => elementsOf(slidesMap(doc).get(slideId)!).get(id)!;

describe("inserting free elements", () => {
  it("adds a text box with its own fragment, centered by default and above everything", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    const e = el(doc, slideId, id);
    expect(e).toMatchObject({ kind: "text", slot: null, x: 600, y: 460, w: 720, h: 160 });
    expect(e.z).toBeGreaterThan(Math.max(...snap(doc, slideId).elements.filter((x) => x.id !== id).map((x) => x.z)));
    expect(textOf(slidesMap(doc).get(slideId)!).get(id)).toBeInstanceOf(Y.XmlFragment);
    expect(slideFragment(doc, slideId, id)).not.toBeNull();
  });

  it("places a text box around the click point and keeps it on the slide", () => {
    const { doc, slideId } = setup();
    const a = addTextBox(doc, slideId, { x: 1000, y: 500 })!;
    expect(el(doc, slideId, a)).toMatchObject({ x: 640, y: 420 });
    const b = addTextBox(doc, slideId, { x: 10, y: 5 })!;
    expect(el(doc, slideId, b)).toMatchObject({ x: 0, y: 0 });
    const c = addTextBox(doc, slideId, { x: 1915, y: 1075 })!;
    const e = el(doc, slideId, c);
    expect(e.x! + e.w!).toBeLessThanOrEqual(1920);
    expect(e.y! + e.h!).toBeLessThanOrEqual(1080);
  });

  it("adds shapes of every kind with a default fill", () => {
    const { doc, slideId } = setup();
    for (const shape of ["rect", "rounded", "ellipse", "line", "arrow"] as const) {
      const id = addShape(doc, slideId, shape)!;
      expect(el(doc, slideId, id)).toMatchObject({ kind: "shape", shape, fill: "accent", slot: null });
    }
  });

  it("adds an image sized to its natural size, scaled down to fit", () => {
    const { doc, slideId } = setup();
    const id = addFreeImage(doc, slideId, "https://x/y.png", "y", { width: 1440, height: 960 })!;
    const e = el(doc, slideId, id);
    expect(e).toMatchObject({ kind: "image", src: "https://x/y.png", alt: "y", w: 720, h: 480 });
    const small = addFreeImage(doc, slideId, "https://x/s.png", "s", { width: 100, height: 50 })!;
    expect(el(doc, slideId, small)).toMatchObject({ w: 100, h: 50 });
  });

  it("replaces a free image's picture", () => {
    const { doc, slideId } = setup();
    const id = addFreeImage(doc, slideId, "https://x/a.png", "a")!;
    setImageSource(doc, slideId, id, "https://x/b.png", "b");
    expect(el(doc, slideId, id)).toMatchObject({ src: "https://x/b.png", alt: "b" });
  });

  it("does nothing on a deleted or missing slide", () => {
    const { doc } = setup();
    expect(addTextBox(doc, "nope")).toBeNull();
    expect(addShape(doc, "nope", "rect")).toBeNull();
  });
});

describe("detach and snap back", () => {
  it("gives a slot element geometry when it is moved, and the layout no longer decides where it is", () => {
    const { doc, slideId } = setup();
    const before = placementOf("content", el(doc, slideId, "body"))!;
    moveElements(doc, slideId, ["body"], 40, 25);
    const e = el(doc, slideId, "body");
    expect(isDetached(e)).toBe(true);
    expect(explicitPlacement(e)).toMatchObject({ x: before.x + 40, y: before.y + 25, w: before.w, h: before.h });
    expect(e.slot).toBe("body");
  });

  it("keeps the detached spot across a layout change", () => {
    const { doc, slideId } = setup();
    moveElements(doc, slideId, ["body"], 100, 100);
    const moved = explicitPlacement(el(doc, slideId, "body"))!;
    setLayout(doc, slideId, "split");
    expect(explicitPlacement(el(doc, slideId, "body"))).toEqual(moved);
    expect(isDetached(el(doc, slideId, "title"))).toBe(false);
  });

  it("keeps drawing a detached element whose slot the new layout lacks", () => {
    const { doc, slideId } = setup();
    moveElements(doc, slideId, ["body"], 0, 10);
    setLayout(doc, slideId, "section");
    const slide = snap(doc, slideId);
    const body = slide.elements.find((e) => e.id === "body")!;
    expect(isFreeRendered(slide.layoutId, body)).toBe(true);
    expect(placedElements(slide).some((p) => p.element.id === "body")).toBe(true);
  });

  it("snaps back to the layout by dropping only the geometry", () => {
    const { doc, slideId } = setup();
    moveElements(doc, slideId, ["body"], 5, 5);
    setPlacements(doc, slideId, { body: { ...explicitPlacement(el(doc, slideId, "body"))!, rot: 12 } });
    snapBack(doc, slideId, ["body"]);
    const e = el(doc, slideId, "body");
    expect(isDetached(e)).toBe(false);
    expect(e.rot).toBeUndefined();
    expect(e.slot).toBe("body");
  });

  it("does not strip geometry from a free element", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    snapBack(doc, slideId, [id]);
    expect(explicitPlacement(el(doc, slideId, id))).not.toBeNull();
  });
});

describe("placement writes", () => {
  it("writes x, y, w, h and rotation rounded to hundredths in one transaction", () => {
    const { doc, slideId } = setup();
    const id = addShape(doc, slideId, "rect")!;
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    setPlacements(doc, slideId, { [id]: { x: 10.123, y: 20, w: 30, h: 40, rot: 5.555 } });
    expect(transactions).toBe(1);
    expect(explicitPlacement(el(doc, slideId, id))).toEqual({ x: 10.12, y: 20, w: 30, h: 40, rot: 5.56 });
  });

  it("ignores ids that are gone", () => {
    const { doc, slideId } = setup();
    expect(() => setPlacements(doc, slideId, { ghost: { x: 0, y: 0, w: 1, h: 1, rot: 0 } })).not.toThrow();
  });
});

describe("align and distribute", () => {
  it("aligns several elements to the selection or to the slide", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 700 })!;
    alignElements(doc, slideId, [a, b], "left", "selection");
    expect(el(doc, slideId, a).x).toBe(el(doc, slideId, b).x);
    alignElements(doc, slideId, [a], "center", "slide");
    const e = el(doc, slideId, a);
    expect(e.x! + e.w! / 2).toBe(960);
  });

  it("will not align a lone element to its own selection", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const before = el(doc, slideId, a).x;
    alignElements(doc, slideId, [a], "right", "selection");
    expect(el(doc, slideId, a).x).toBe(before);
  });

  it("distributes three elements with equal gaps and ignores fewer", () => {
    const { doc, slideId } = setup();
    const ids = [200, 330, 1200].map((x) => addShape(doc, slideId, "ellipse", { x, y: 500 })!);
    distributeElements(doc, slideId, ids, "x");
    const [a, b, c] = ids.map((id) => el(doc, slideId, id));
    expect(b.x! - (a.x! + a.w!)).toBeCloseTo(c.x! - (b.x! + b.w!));
    const before = el(doc, slideId, ids[1]).x;
    distributeElements(doc, slideId, ids.slice(0, 2), "x");
    expect(el(doc, slideId, ids[1]).x).toBe(before);
  });
});

describe("groups", () => {
  it("groups free elements and moving the group moves its children together", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "ellipse", { x: 900, y: 700 })!;
    const g = groupElements(doc, slideId, [a, b])!;
    const slide = snap(doc, slideId);
    expect(slide.elements.find((e) => e.id === g)).toMatchObject({ kind: "group", slot: null, children: [a, b] });
    expect(slide.elements.find((e) => e.id === a)!.parentId).toBe(g);
    const ax = el(doc, slideId, a).x!;
    moveElements(doc, slideId, [g], 50, 0);
    expect(el(doc, slideId, a).x).toBe(ax + 50);
    expect(el(doc, slideId, b).x).toBe(el(doc, slideId, b).x);
  });

  it("needs two elements", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    expect(groupElements(doc, slideId, [a])).toBeNull();
  });

  it("does not draw or place the group itself", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "rect")!;
    const g = groupElements(doc, slideId, [a, b])!;
    expect(placedElements(snap(doc, slideId)).some((p) => p.element.id === g)).toBe(false);
  });

  it("ungroups by tombstoning the group and leaves the children where they are", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 700 })!;
    const g = groupElements(doc, slideId, [a, b])!;
    const kids = ungroupElements(doc, slideId, [g]);
    expect(kids).toEqual([a, b]);
    expect(isDeleted(raw(doc, slideId, g))).toBe(true);
    expect(el(doc, slideId, a).parentId).toBeUndefined();
    expect(el(doc, slideId, a).x).toBe(300 - 240);
  });

  it("regrouping merges an old group instead of nesting", () => {
    const { doc, slideId } = setup();
    const [a, b, c] = [1, 2, 3].map((i) => addShape(doc, slideId, "rect", { x: i * 300, y: 300 })!);
    const g1 = groupElements(doc, slideId, [a, b])!;
    const g2 = groupElements(doc, slideId, [g1, c])!;
    expect(isDeleted(raw(doc, slideId, g1))).toBe(true);
    expect(snap(doc, slideId).elements.find((e) => e.id === g2)!.children).toEqual([a, b, c]);
  });
});

describe("delete is a tombstone", () => {
  it("keeps the element map entry and its text fragment, marks it deleted, and hides it", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId)!;
    blocksToFragment([{ type: "paragraph", content: "hello" }] as never, slideFragment(doc, slideId, id)!);
    expect(deleteElements(doc, slideId, [id])).toEqual([id]);
    expect(raw(doc, slideId, id)).toBeDefined();
    expect(raw(doc, slideId, id).get("deleted")).toBe(true);
    expect(slideFragment(doc, slideId, id)!.length).toBeGreaterThan(0);
    expect(snap(doc, slideId).elements.some((e) => e.id === id)).toBe(false);
    expect(readDeck(doc).slides[0].elements.some((e) => e.id === id)).toBe(false);
  });

  it("deleting a group tombstones it and its children", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "rect")!;
    const g = groupElements(doc, slideId, [a, b])!;
    deleteElements(doc, slideId, [g]);
    for (const id of [a, b, g]) expect(isDeleted(raw(doc, slideId, id))).toBe(true);
  });

  it("keeps a layout text box that has text, and clears an image box's picture before removing it", () => {
    const { doc, slideId } = setup("split");
    blocksToFragment([{ type: "paragraph", content: "Heading" }] as never, slideFragment(doc, slideId, "title")!);
    elementsOf(slidesMap(doc).get(slideId)!).get("image")!.set("src", "https://x/y.png");
    expect(deleteElements(doc, slideId, ["title", "image"])).toEqual([]);
    expect(isDeleted(raw(doc, slideId, "title"))).toBe(false);
    expect(el(doc, slideId, "image").src).toBe("");
    expect(deleteElements(doc, slideId, ["image"])).toEqual(["image"]);
    expect(snap(doc, slideId).elements.some((e) => e.id === "image")).toBe(false);
  });

  it("a peer's concurrent typing into a deleted text box still lands in the doc", () => {
    const a = new Y.Doc();
    initDeck(a);
    const slideId = addSlide(a, "content", null);
    const id = addTextBox(a, slideId)!;
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    deleteElements(a, slideId, [id]);
    blocksToFragment([{ type: "paragraph", content: "typed meanwhile" }] as never, slideFragment(b, slideId, id)!);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(slideFragment(a, slideId, id)!.length).toBeGreaterThan(0);
    expect(isDeleted(raw(b, slideId, id))).toBe(true);
  });
});

describe("z order", () => {
  it("moves a selection forward and back one step past its neighbors", () => {
    const { doc, slideId } = setup();
    const [a, b, c] = [1, 2, 3].map((i) => addShape(doc, slideId, "rect", { x: i * 300, y: 300 })!);
    const order = () => snap(doc, slideId).elements.filter((e) => [a, b, c].includes(e.id)).map((e) => e.id);
    expect(order()).toEqual([a, b, c]);
    reorderElements(doc, slideId, [a], "forward");
    expect(order()).toEqual([b, a, c]);
    reorderElements(doc, slideId, [c], "backward");
    expect(order()).toEqual([b, c, a]);
    reorderElements(doc, slideId, [a], "back");
    expect(order()).toEqual([a, b, c]);
    reorderElements(doc, slideId, [a], "front");
    expect(order()).toEqual([b, c, a]);
  });

  it("does nothing when already at the end, and orders slot elements among free ones", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    reorderElements(doc, slideId, [a], "forward");
    expect(snap(doc, slideId).elements.at(-1)!.id).toBe(a);
    reorderElements(doc, slideId, [a], "back");
    expect(snap(doc, slideId).elements[0].id).toBe(a);
  });

  it("moves a group's children together", () => {
    const { doc, slideId } = setup();
    const [a, b, c] = [1, 2, 3].map((i) => addShape(doc, slideId, "rect", { x: i * 300, y: 300 })!);
    const g = groupElements(doc, slideId, [a, b])!;
    reorderElements(doc, slideId, [g], "front");
    const order = snap(doc, slideId).elements.filter((e) => [a, b, c].includes(e.id)).map((e) => e.id);
    expect(order).toEqual([c, a, b]);
  });
});

describe("duplicate", () => {
  it("copies a text box with its text, offset, on top, with new ids", () => {
    const { doc, slideId } = setup();
    const id = addTextBox(doc, slideId, { x: 500, y: 500 })!;
    blocksToFragment([{ type: "paragraph", content: "hello" }] as never, slideFragment(doc, slideId, id)!);
    const [copy] = duplicateElements(doc, slideId, [id]);
    expect(copy).not.toBe(id);
    const a = el(doc, slideId, id);
    const b = el(doc, slideId, copy);
    expect(b).toMatchObject({ kind: "text", slot: null, x: a.x! + 24, y: a.y! + 24, w: a.w, h: a.h });
    expect(b.z).toBeGreaterThan(a.z);
    const read = readDeck(doc).slides[0].elements.find((e) => e.id === copy)!;
    expect(read.text).toBe("hello");
    blocksToFragment([{ type: "paragraph", content: " more" }] as never, slideFragment(doc, slideId, copy)!);
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === id)!.text).toBe("hello");
  });

  it("copies a slot element as a free element at the place the slot draws", () => {
    const { doc, slideId } = setup();
    const [copy] = duplicateElements(doc, slideId, ["title"]);
    const e = el(doc, slideId, copy);
    expect(e.slot).toBeNull();
    expect(e).toMatchObject({ x: 160 + 24, y: 110 + 24, w: 1600, h: 150 });
    expect(el(doc, slideId, "title").slot).toBe("title");
  });

  it("duplicates a group as a group of copies", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "rect")!;
    const g = groupElements(doc, slideId, [a, b])!;
    const [copy] = duplicateElements(doc, slideId, [g]);
    const group = snap(doc, slideId).elements.find((e) => e.id === copy)!;
    expect(group.kind).toBe("group");
    expect(group.children).toHaveLength(2);
    expect(group.children!.some((c) => [a, b].includes(c))).toBe(false);
  });

  it("returns nothing for an empty selection", () => {
    const { doc, slideId } = setup();
    expect(duplicateElements(doc, slideId, [])).toEqual([]);
  });
});

describe("paste", () => {
  it("writes sanitized items as new free elements with text", () => {
    const { doc, slideId } = setup();
    const ids = pasteItems(doc, slideId, [
      { key: "t", kind: "text", placed: { x: 100, y: 100, w: 400, h: 100, rot: 0 }, textStyle: "heading", blocks: [{ type: "paragraph", content: [{ type: "text", text: "pasted", styles: { bold: true } }], children: [] }] },
      { key: "i", kind: "image", placed: { x: 10, y: 10, w: 100, h: 100, rot: 0 }, src: "https://x/y.png", alt: "y" },
      { key: "s", kind: "shape", placed: { x: 0, y: 0, w: 50, h: 50, rot: 10 }, shape: "ellipse", fill: "muted" },
    ]);
    expect(ids).toHaveLength(3);
    const text = el(doc, slideId, ids[0]);
    expect(text).toMatchObject({ kind: "text", slot: null, textStyle: "heading", x: 124, y: 124 });
    expect(readDeck(doc).slides[0].elements.find((e) => e.id === ids[0])!.text).toBe("pasted");
    expect(el(doc, slideId, ids[2])).toMatchObject({ shape: "ellipse", fill: "muted", rot: 10 });
  });

  it("rebuilds a pasted group around the new ids", () => {
    const { doc, slideId } = setup();
    const ids = pasteItems(doc, slideId, [
      { key: "a", kind: "shape", placed: { x: 0, y: 0, w: 50, h: 50, rot: 0 }, shape: "rect" },
      { key: "b", kind: "shape", placed: { x: 100, y: 0, w: 50, h: 50, rot: 0 }, shape: "rect" },
      { key: "g", kind: "group", placed: { x: 0, y: 0, w: 150, h: 50, rot: 0 }, children: ["a", "b"] },
    ]);
    expect(ids).toHaveLength(1);
    const group = el(doc, slideId, ids[0]);
    expect(group.kind).toBe("group");
    expect(group.children!.map((c) => el(doc, slideId, c).kind)).toEqual(["shape", "shape"]);
  });
});

describe("fill and snapshot safety", () => {
  it("sets a theme fill on shapes only", () => {
    const { doc, slideId } = setup();
    const s = addShape(doc, slideId, "rect")!;
    const t = addTextBox(doc, slideId)!;
    setFill(doc, slideId, [s, t], "rule");
    expect(el(doc, slideId, s).fill).toBe("rule");
    expect(el(doc, slideId, t).fill).toBeUndefined();
  });

  it("reads an unknown kind, a bad shape and a half-written geometry without crashing or misplacing them", () => {
    const { doc, slideId } = setup();
    const slide = slidesMap(doc).get(slideId)!;
    const weird = new Y.Map<unknown>();
    weird.set("id", "w");
    weird.set("kind", "hologram");
    weird.set("z", 9);
    weird.set("deleted", false);
    weird.set("x", 10);
    weird.set("shape", "blob");
    weird.set("fill", "neon");
    elementsOf(slide).set("w", weird);
    const read = snapshotSlide(slideId, slide).elements.find((e) => e.id === "w")!;
    expect(read.kind).toBe("hologram");
    expect(read.shape).toBeUndefined();
    expect(read.fill).toBeUndefined();
    expect(placementOf("content", read)).toBeNull();
    expect(placedElements(snapshotSlide(slideId, slide)).some((p) => p.element.id === "w")).toBe(false);
  });

  it("treats an element with no slot and no geometry as not placed", () => {
    const { doc, slideId } = setup();
    const slide = slidesMap(doc).get(slideId)!;
    const bare = new Y.Map<unknown>();
    bare.set("id", "bare");
    bare.set("kind", "text");
    bare.set("z", 5);
    bare.set("deleted", false);
    elementsOf(slide).set("bare", bare);
    expect(placedElements(snapshotSlide(slideId, slide)).map((p) => p.element.id)).not.toContain("bare");
  });

  it("reads placements for a mixed selection", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const map = placementsOf(doc, slideId, ["title", a]);
    expect([...map.keys()].sort()).toEqual(["title", a].sort());
  });
});

describe("removing empty layout boxes", () => {
  const live = (doc: Y.Doc, slideId: string) => snap(doc, slideId).elements.map((e) => e.id);
  const removeBody = () => {
    const { doc, slideId } = setup();
    expect(deleteElements(doc, slideId, ["body"])).toEqual(["body"]);
    return { doc, slideId };
  };

  it("removes an empty text box and keeps the rest of the slide", () => {
    const { doc, slideId } = removeBody();
    expect(live(doc, slideId)).toEqual(["title"]);
    expect(readDeck(doc).slides[0].elements.map((e) => e.id)).toEqual(["title"]);
  });

  it("counts a box holding only an empty paragraph as empty", () => {
    const { doc, slideId } = setup();
    blocksToFragment([{ type: "paragraph", content: "" }] as never, slideFragment(doc, slideId, "body")!);
    expect(deleteElements(doc, slideId, ["body"])).toEqual(["body"]);
  });

  it("isn't brought back by the open-time repair, writes that complete slots, or duplicating", () => {
    const { doc, slideId } = removeBody();
    const slide = slidesMap(doc).get(slideId)!;
    expect(slideMissingSlot(slide)).toBe(false);
    expect(deckMissingSlots(readDeck(doc))).toBe(false);
    expect(readDeck(doc).slides[0].removedSlots).toEqual(["body"]);
    repairDeckSlots(doc);
    expect(live(doc, slideId)).toEqual(["title"]);
    const copy = duplicateSlide(doc, slideId)!;
    expect(live(doc, copy)).toEqual(["title"]);
  });

  it("still repairs a slot that went missing without anyone removing it", () => {
    const { doc, slideId } = setup();
    raw(doc, slideId, "body").set("deleted", true);
    expect(deckMissingSlots(readDeck(doc))).toBe(true);
    repairDeckSlots(doc);
    expect(live(doc, slideId)).toContain("body");
  });

  it("comes back when a layout is chosen", () => {
    const { doc, slideId } = removeBody();
    setLayout(doc, slideId, "content");
    expect(live(doc, slideId)).toEqual(["title", "body"]);
    expect(raw(doc, slideId, "body").has("slotRemoved")).toBe(false);
  });

  it("comes back on snap back, in its layout place", () => {
    const { doc, slideId } = removeBody();
    snapBack(doc, slideId, ["body"]);
    expect(live(doc, slideId)).toContain("body");
    expect(isDetached(el(doc, slideId, "body"))).toBe(false);
  });

  it("an image box comes back when a picture is set on it", () => {
    const { doc, slideId } = setup("split");
    deleteElements(doc, slideId, ["image"]);
    setSlotImage(doc, slideId, "https://x/y.png", "A picture");
    expect(el(doc, slideId, "image")).toMatchObject({ src: "https://x/y.png" });
    expect(raw(doc, slideId, "image").has("slotRemoved")).toBe(false);
  });
});
