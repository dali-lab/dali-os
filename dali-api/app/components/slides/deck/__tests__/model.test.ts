import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  between,
  compareZ,
  comparePos,
  deckAccessMode,
  deckMap,
  elementsOf,
  initDeck,
  isDeleted,
  newElementMap,
  newSlideMap,
  restoreEpochOf,
  restoreSlide,
  slidesMap,
  tombstoneElement,
  tombstoneSlide,
} from "../model";

describe("deck model", () => {
  it("initDeck writes the version, theme and a zero restore epoch", () => {
    const doc = new Y.Doc();
    initDeck(doc);
    expect(deckMap(doc).get("v")).toBe(1);
    expect(deckMap(doc).get("themeId")).toBe("dali-dark");
    expect(deckMap(doc).get("themeOverrides")).toBeInstanceOf(Y.Map);
    expect(restoreEpochOf(doc)).toBe(0);
  });

  it("restoreEpochOf is 0 when unset", () => {
    expect(restoreEpochOf(new Y.Doc())).toBe(0);
  });

  it("a new slide has the keyed sub-structures and is not deleted", () => {
    const doc = new Y.Doc();
    const slide = newSlideMap("s1", 1, "title");
    slidesMap(doc).set("s1", slide);
    expect(slide.get("elements")).toBeInstanceOf(Y.Map);
    expect(slide.get("text")).toBeInstanceOf(Y.Map);
    expect(slide.get("notes")).toBeInstanceOf(Y.XmlFragment);
    expect(isDeleted(slide)).toBe(false);
  });

  it("tombstones keep the entry and can be undone", () => {
    const doc = new Y.Doc();
    const slide = newSlideMap("s1", 1, "title");
    slidesMap(doc).set("s1", slide);
    const el = newElementMap("title", "text", 1);
    elementsOf(slide).set("title", el);
    tombstoneSlide(slide);
    tombstoneElement(el);
    expect(slidesMap(doc).has("s1")).toBe(true);
    expect(isDeleted(slide)).toBe(true);
    expect(isDeleted(el)).toBe(true);
    restoreSlide(slide);
    expect(isDeleted(slide)).toBe(false);
  });

  it("exports no hard-delete helper", async () => {
    const mod = await import("../model");
    expect(Object.keys(mod).filter((k) => /^(delete|remove)/i.test(k))).toEqual([]);
  });

  it("an unknown deck version is read-only", () => {
    expect(deckAccessMode(1)).toBe("edit");
    expect(deckAccessMode(2)).toBe("readonly");
    expect(deckAccessMode(undefined)).toBe("readonly");
  });

  it("between returns positions that sort between neighbours", () => {
    expect(between()).toBe(1);
    expect(between(undefined, 3)).toBeLessThan(3);
    expect(between(3)).toBeGreaterThan(3);
    const mid = between(1, 2);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });

  it("orders by position then id so concurrent equal positions agree", () => {
    const rows = [
      { id: "b", pos: 1 },
      { id: "a", pos: 1 },
      { id: "c", pos: 0.5 },
    ];
    expect(rows.sort(comparePos).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect([{ id: "x", z: 2 }, { id: "y", z: 1 }].sort(compareZ).map((r) => r.id)).toEqual(["y", "x"]);
  });
});
