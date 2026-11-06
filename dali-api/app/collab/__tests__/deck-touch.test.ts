import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addSlide, setLayout, slideFragment } from "~/components/slides/deck/deck-ops";
import { addShape, addTextBox, moveElements } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { collectDeckTouch } from "../deck-touch";

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const s1 = addSlide(doc, "content", null);
  const s2 = addSlide(doc, "content", s1);
  return { doc, s1, s2 };
}

describe("collectDeckTouch", () => {
  it("reports an added element by slide-scoped key and puts the agent on its slide", () => {
    const { doc, s2 } = deck();
    let id: string | null = null;
    const touch = collectDeckTouch(doc, () => {
      id = addShape(doc, s2, "rect");
    });
    expect(touch.elementKeys).toEqual([`${s2}/${id}`]);
    expect(touch.slideId).toBe(s2);
    expect(touch.slideIds).toEqual([s2]);
  });

  it("reports a moved element and text typed into a layout box", () => {
    const { doc, s1 } = deck();
    const box = addTextBox(doc, s1)!;
    const touch = collectDeckTouch(doc, () => {
      moveElements(doc, s1, [box], 10, 10);
      slideFragment(doc, s1, "title")!.insert(0, [new Y.XmlText("Hi")]);
    });
    expect(touch.elementKeys.sort()).toEqual([`${s1}/${box}`, `${s1}/title`].sort());
  });

  it("scopes a slot name to its slide, since every slide has one", () => {
    const { doc, s1, s2 } = deck();
    const touch = collectDeckTouch(doc, () => {
      slideFragment(doc, s1, "title")!.insert(0, [new Y.XmlText("A")]);
      slideFragment(doc, s2, "title")!.insert(0, [new Y.XmlText("B")]);
    });
    expect(touch.elementKeys).toEqual([`${s1}/title`, `${s2}/title`]);
    expect(touch.slideId).toBe(s2);
  });

  it("reports a slide-level change with no elements, and an added slide", () => {
    const { doc, s1 } = deck();
    let added = "";
    const touch = collectDeckTouch(doc, () => {
      setLayout(doc, s1, "section");
      added = addSlide(doc, "content", s1);
    });
    expect(touch.slideIds).toContain(s1);
    expect(touch.slideIds).toContain(added);
    expect(touch.slideId).not.toBeNull();
  });

  it("ignores changes outside the run and stops listening even when the run throws", () => {
    const { doc, s1 } = deck();
    expect(() =>
      collectDeckTouch(doc, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    addTextBox(doc, s1);
    const touch = collectDeckTouch(doc, () => {});
    expect(touch).toEqual({ slideIds: [], elementKeys: [], slideId: null });
  });

  it("ignores changes to the deck's own settings", () => {
    const { doc } = deck();
    const touch = collectDeckTouch(doc, () => doc.getMap("deck").set("themeId", "dali-light"));
    expect(touch).toEqual({ slideIds: [], elementKeys: [], slideId: null });
  });
});
