import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { projectLegacySlides, readDeck } from "~/collab/read-deck.server";
import {
  addSlide,
  clearSlotImage,
  deleteSlide,
  duplicateSlide,
  ensureSlotsOn,
  moveSlide,
  setLayout,
  setSlotImage,
  setTextStyle,
  setThemeId,
  slideFragment,
  undeleteSlide,
  visibleSlideIds,
} from "../deck-ops";
import { elementsOf, initDeck, isDeleted, notesOf, slidesMap, deckMap, newSlideMap } from "../model";
import { snapshotDeck } from "../snapshot";

function deck(n = 3) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "content", ids[i - 1] ?? null));
  return { doc, ids };
}
const pos = (doc: Y.Doc, id: string) => Number(slidesMap(doc).get(id)!.get("pos"));

describe("add and duplicate", () => {
  it("a new slide gets an element and a fragment for every slot of its layout", () => {
    const { doc, ids } = deck(1);
    const slide = slidesMap(doc).get(ids[0])!;
    expect([...elementsOf(slide).keys()].sort()).toEqual(["body", "title"]);
    expect(slideFragment(doc, ids[0], "body")).toBeInstanceOf(Y.XmlFragment);
  });

  it("inserts after the given slide, or at the end", () => {
    const { doc, ids } = deck(3);
    const mid = addSlide(doc, "title", ids[0]);
    const end = addSlide(doc, "title", null);
    expect(visibleSlideIds(doc)).toEqual([ids[0], mid, ids[1], ids[2], end]);
  });

  it("duplicates text, notes and image into the next position without sharing structure", () => {
    const { doc, ids } = deck(2);
    blocksToFragment([{ type: "paragraph", content: "Hello" }] as never, slideFragment(doc, ids[0], "title")!);
    blocksToFragment([{ type: "paragraph", content: "say it" }] as never, notesOf(slidesMap(doc).get(ids[0])!));
    setLayout(doc, ids[0], "split");
    setSlotImage(doc, ids[0], "https://x/y.png", "y");
    const copy = duplicateSlide(doc, ids[0])!;
    expect(visibleSlideIds(doc)).toEqual([ids[0], copy, ids[1]]);
    const snap = snapshotDeck(doc).slides.find((s) => s.id === copy)!;
    expect(snap.layoutId).toBe("split");
    expect(snap.elements.find((e) => e.slot === "image")?.src).toBe("https://x/y.png");
    expect(readDeck(doc).slides.find((s) => s.id === copy)!.notes.text).toBe("say it");
    blocksToFragment([{ type: "paragraph", content: "changed" }] as never, slideFragment(doc, copy, "title")!);
    expect(readDeck(doc).slides.find((s) => s.id === ids[0])!.elements.find((e) => e.slot === "title")!.text).toBe("Hello");
  });

  it("does not duplicate a deleted or missing slide", () => {
    const { doc, ids } = deck(1);
    deleteSlide(doc, ids[0]);
    expect(duplicateSlide(doc, ids[0])).toBeNull();
    expect(duplicateSlide(doc, "nope")).toBeNull();
  });
});

describe("delete is a tombstone", () => {
  it("keeps the slide in the map, hides it from reads and restores it", () => {
    const { doc, ids } = deck(3);
    deleteSlide(doc, ids[1]);
    expect(slidesMap(doc).has(ids[1])).toBe(true);
    expect(isDeleted(slidesMap(doc).get(ids[1])!)).toBe(true);
    expect(visibleSlideIds(doc)).toEqual([ids[0], ids[2]]);
    expect(snapshotDeck(doc).deletedIds).toEqual([ids[1]]);
    expect(readDeck(doc).slides.map((s) => s.id)).toEqual([ids[0], ids[2]]);
    undeleteSlide(doc, ids[1]);
    expect(visibleSlideIds(doc)).toEqual(ids);
  });

  it("never calls Y.Map.delete on the slides map", () => {
    const { doc, ids } = deck(2);
    const del = slidesMap(doc).delete.bind(slidesMap(doc));
    let called = false;
    slidesMap(doc).delete = (k: string) => ((called = true), del(k));
    deleteSlide(doc, ids[0]);
    undeleteSlide(doc, ids[0]);
    expect(called).toBe(false);
  });
});

describe("reorder by fractional pos", () => {
  it("changes only the moved slide's pos", () => {
    const { doc, ids } = deck(4);
    const before = ids.map((id) => pos(doc, id));
    moveSlide(doc, ids[3], 1);
    expect(visibleSlideIds(doc)).toEqual([ids[0], ids[3], ids[1], ids[2]]);
    expect(ids.filter((id, i) => pos(doc, id) !== before[i])).toEqual([ids[3]]);
    expect(pos(doc, ids[3])).toBeGreaterThan(before[0]);
    expect(pos(doc, ids[3])).toBeLessThan(before[1]);
  });

  it("moves to the ends and clamps an out-of-range index", () => {
    const { doc, ids } = deck(3);
    moveSlide(doc, ids[2], 0);
    expect(visibleSlideIds(doc)).toEqual([ids[2], ids[0], ids[1]]);
    moveSlide(doc, ids[2], 99);
    expect(visibleSlideIds(doc)).toEqual([ids[0], ids[1], ids[2]]);
  });

  it("two peers moving different slides at once converge with nothing lost or duplicated", () => {
    const { doc, ids } = deck(4);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    moveSlide(doc, ids[0], 3);
    moveSlide(other, ids[3], 0);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    expect(visibleSlideIds(doc)).toEqual(visibleSlideIds(other));
    expect([...visibleSlideIds(doc)].sort()).toEqual([...ids].sort());
  });
});

describe("layouts and slots", () => {
  it("changing the layout adds the new slots and keeps text from the old ones", () => {
    const { doc, ids } = deck(1);
    blocksToFragment([{ type: "paragraph", content: "Body text" }] as never, slideFragment(doc, ids[0], "body")!);
    setLayout(doc, ids[0], "title");
    expect(snapshotDeck(doc).slides[0].layoutId).toBe("title");
    expect(elementsOf(slidesMap(doc).get(ids[0])!).has("subtitle")).toBe(true);
    setLayout(doc, ids[0], "content");
    expect(readDeck(doc).slides[0].elements.find((e) => e.slot === "body")!.text).toBe("Body text");
  });

  it("revives a slot a legacy write tombstoned", () => {
    const { doc, ids } = deck(1);
    elementsOf(slidesMap(doc).get(ids[0])!).get("body")!.set("deleted", true);
    expect(ensureSlotsOn(doc, ids[0])).toBe(true);
    expect(isDeleted(elementsOf(slidesMap(doc).get(ids[0])!).get("body")!)).toBe(false);
    expect(ensureSlotsOn(doc, ids[0])).toBe(false);
  });

  it("creates the missing slots of a slide converted from JSON", () => {
    const doc = new Y.Doc();
    initDeck(doc);
    slidesMap(doc).set("s", newSlideMap("s", 1, "split"));
    expect(ensureSlotsOn(doc, "s")).toBe(true);
    expect([...elementsOf(slidesMap(doc).get("s")!).keys()].sort()).toEqual(["body", "image", "title"]);
  });

  it("stores an image as a URL only and clears it without removing the element", () => {
    const { doc, ids } = deck(1);
    setLayout(doc, ids[0], "split");
    setSlotImage(doc, ids[0], "/api/upload/raw?key=doc-images%2Fa.png", "A");
    const el = elementsOf(slidesMap(doc).get(ids[0])!).get("image")!;
    expect(el.get("src")).toMatch(/^\/api\/upload\/raw/);
    expect(String(el.get("src"))).not.toMatch(/^data:/);
    clearSlotImage(doc, ids[0]);
    expect(el.get("src")).toBe("");
    expect(elementsOf(slidesMap(doc).get(ids[0])!).has("image")).toBe(true);
  });

  it("sets and clears a text style and the deck theme", () => {
    const { doc, ids } = deck(1);
    setTextStyle(doc, ids[0], "body", "kicker");
    expect(snapshotDeck(doc).slides[0].elements.find((e) => e.slot === "body")!.textStyle).toBe("kicker");
    setTextStyle(doc, ids[0], "body", null);
    expect(snapshotDeck(doc).slides[0].elements.find((e) => e.slot === "body")!.textStyle).toBeNull();
    setThemeId(doc, "dali-light");
    expect(deckMap(doc).get("themeId")).toBe("dali-light");
  });

  it("leaves the MCP projection of an edited deck in the legacy shape", () => {
    const { doc, ids } = deck(2);
    setLayout(doc, ids[0], "section");
    setLayout(doc, ids[1], "bignumber");
    const out = projectLegacySlides(readDeck(doc));
    expect(out.map((s) => s.layout)).toEqual(["title", "title"]);
  });
});
