// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addSlide } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import { addShape, groupElements, moveElements, setPlacements } from "../freeform-ops";
import { explicitPlacement } from "../freeform";
import { deckMap, initDeck, slidesMap } from "../model";
import { snapshotDeck } from "../snapshot";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "content", null);
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  return { doc, slideId, undo };
}
const place = (doc: Y.Doc, slideId: string, id: string) => explicitPlacement(snapshotDeck(doc).slides[0].elements.find((e) => e.id === id)!);

describe("one undo step per gesture", () => {
  it("two quick drags undo one at a time", () => {
    const { doc, slideId, undo } = setup();
    const id = undo.step(() => addShape(doc, slideId, "rect", { x: 500, y: 500 }))!;
    const start = place(doc, slideId, id)!;
    undo.step(() => setPlacements(doc, slideId, { [id]: { ...start, x: start.x + 100 } }));
    undo.step(() => setPlacements(doc, slideId, { [id]: { ...start, x: start.x + 200 } }));
    expect(place(doc, slideId, id)!.x).toBe(start.x + 200);
    undo.manager.undo();
    expect(place(doc, slideId, id)!.x).toBe(start.x + 100);
    undo.manager.undo();
    expect(place(doc, slideId, id)!.x).toBe(start.x);
    undo.manager.redo();
    expect(place(doc, slideId, id)!.x).toBe(start.x + 100);
  });

  it("moving many elements at once is a single step", () => {
    const { doc, slideId, undo } = setup();
    const a = undo.step(() => addShape(doc, slideId, "rect", { x: 300, y: 300 }))!;
    const b = undo.step(() => addShape(doc, slideId, "ellipse", { x: 900, y: 600 }))!;
    const ax = place(doc, slideId, a)!.x;
    const bx = place(doc, slideId, b)!.x;
    undo.step(() => moveElements(doc, slideId, [a, b], 40, 0));
    expect(place(doc, slideId, a)!.x).toBe(ax + 40);
    undo.manager.undo();
    expect(place(doc, slideId, a)!.x).toBe(ax);
    expect(place(doc, slideId, b)!.x).toBe(bx);
  });

  it("grouping is undone in one step", () => {
    const { doc, slideId, undo } = setup();
    const a = undo.step(() => addShape(doc, slideId, "rect"))!;
    const b = undo.step(() => addShape(doc, slideId, "rect"))!;
    undo.step(() => groupElements(doc, slideId, [a, b]));
    expect(snapshotDeck(doc).slides[0].elements.some((e) => e.kind === "group")).toBe(true);
    undo.manager.undo();
    expect(snapshotDeck(doc).slides[0].elements.some((e) => e.kind === "group")).toBe(false);
  });

  it("step returns the callback's value and closes the entry even if it throws", () => {
    const { undo } = setup();
    expect(undo.step(() => 7)).toBe(7);
    expect(() =>
      undo.step(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});
