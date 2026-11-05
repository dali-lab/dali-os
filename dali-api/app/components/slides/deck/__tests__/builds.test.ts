import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildOf, buildSteps, isVisibleAt, movePosition, visibleBlocks, type DeckPosition } from "../builds";
import { addSlide, setBuild, setBuildBullets } from "../deck-ops";
import { elementsOf, initDeck, slidesMap } from "../model";
import { snapshotDeck, type RenderElement, type RenderSlide } from "../snapshot";

const el = (slot: string, extra: Partial<RenderElement> = {}): RenderElement => ({
  id: slot,
  kind: "text",
  slot,
  z: 1,
  blocks: [],
  src: null,
  alt: null,
  textStyle: null,
  ...extra,
});
const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) })) as never;
const slide = (elements: RenderElement[]): RenderSlide => ({ id: "s", pos: 1, layoutId: "content", elements });

describe("buildOf", () => {
  it("accepts only whole numbers from 1", () => {
    expect([1, 2, 7].map(buildOf)).toEqual([1, 2, 7]);
    expect([0, -1, 1.5, "2", null, undefined, NaN].map(buildOf)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("buildSteps", () => {
  it("is zero when nothing builds", () => {
    expect(buildSteps(slide([]))).toBe(0);
    expect(buildSteps(slide([el("title"), el("body", { blocks: blocks(4) })]))).toBe(0);
  });

  it("is the highest step an element appears at", () => {
    expect(buildSteps(slide([el("title"), el("body", { build: 1 }), el("image", { build: 3 })]))).toBe(3);
  });

  it("counts one step per top-level block after the slot's own step", () => {
    expect(buildSteps(slide([el("body", { buildBullets: true, blocks: blocks(3) })]))).toBe(3);
    expect(buildSteps(slide([el("body", { buildBullets: true, build: 2, blocks: blocks(3) })]))).toBe(5);
  });

  it("ignores bullets on an empty slot and the flag when it is off", () => {
    expect(buildSteps(slide([el("body", { buildBullets: true, blocks: [] })]))).toBe(0);
    expect(buildSteps(slide([el("body", { buildBullets: false, build: 1, blocks: blocks(5) })]))).toBe(1);
  });
});

describe("what shows at a step", () => {
  it("hides an element until its step", () => {
    const e = el("body", { build: 2 });
    expect([0, 1, 2, 3].map((s) => isVisibleAt(e, s))).toEqual([false, false, true, true]);
    expect(isVisibleAt(el("title"), 0)).toBe(true);
  });

  it("reveals bullets one at a time after the slot's step", () => {
    const e = el("body", { buildBullets: true, build: 1 });
    const all = ["a", "b", "c"];
    expect([0, 1, 2, 3, 4, 9].map((s) => visibleBlocks(e, all, s))).toEqual([[], [], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c"]]);
  });

  it("shows every block of a slot that is not set to build bullets", () => {
    expect(visibleBlocks(el("body", { build: 1 }), ["a", "b"], 1)).toEqual(["a", "b"]);
  });
});

describe("movePosition", () => {
  const steps = [0, 2, 0];
  const stepsOf = (i: number) => steps[i];
  const at = (index: number, step: number): DeckPosition => ({ index, step });
  const next = (p: DeckPosition) => movePosition("next", p, 3, stepsOf);
  const prev = (p: DeckPosition) => movePosition("prev", p, 3, stepsOf);

  it("moves between slides that have no builds", () => {
    expect(next(at(0, 0))).toEqual(at(1, 0));
    expect(next(at(2, 0))).toEqual(at(2, 0));
    expect(prev(at(2, 0))).toEqual(at(1, 2));
    expect(prev(at(0, 0))).toEqual(at(0, 0));
  });

  it("walks the steps of a slide before leaving it", () => {
    expect(next(at(1, 0))).toEqual(at(1, 1));
    expect(next(at(1, 1))).toEqual(at(1, 2));
    expect(next(at(1, 2))).toEqual(at(2, 0));
  });

  it("goes back through the steps, then to the last step of the previous slide", () => {
    expect(prev(at(1, 2))).toEqual(at(1, 1));
    expect(prev(at(1, 1))).toEqual(at(1, 0));
    expect(prev(at(1, 0))).toEqual(at(0, 0));
    expect(prev(at(2, 0))).toEqual(at(1, 2));
  });

  it("jumps to the first slide, or the last slide fully built", () => {
    expect(movePosition("first", at(1, 2), 3, stepsOf)).toEqual(at(0, 0));
    expect(movePosition("last", at(0, 0), 3, (i) => [0, 0, 4][i])).toEqual(at(2, 4));
  });

  it("does nothing on an empty deck", () => {
    expect(movePosition("next", at(0, 0), 0, stepsOf)).toEqual(at(0, 0));
  });
});

describe("builds in the deck doc", () => {
  const setup = () => {
    const doc = new Y.Doc();
    initDeck(doc);
    const id = addSlide(doc, "content", null);
    return { doc, id };
  };

  it("writes build and buildBullets on the element and snapshots them", () => {
    const { doc, id } = setup();
    setBuild(doc, id, "body", 2);
    setBuildBullets(doc, id, "body", true);
    const body = elementsOf(slidesMap(doc).get(id)!).get("body")!;
    expect([body.get("build"), body.get("buildBullets")]).toEqual([2, true]);
    expect(snapshotDeck(doc).slides[0].elements.find((e) => e.slot === "body")).toMatchObject({ build: 2, buildBullets: true });
  });

  it("clears a build back to with slide, and leaves the keys out of the snapshot", () => {
    const { doc, id } = setup();
    setBuild(doc, id, "body", 3);
    setBuild(doc, id, "body", null);
    setBuildBullets(doc, id, "body", false);
    const snap = snapshotDeck(doc).slides[0].elements.find((e) => e.slot === "body")!;
    expect("build" in snap).toBe(false);
    expect("buildBullets" in snap).toBe(false);
  });

  it("treats a build below 1 as none and ignores a slot that doesn't exist", () => {
    const { doc, id } = setup();
    setBuild(doc, id, "body", 0);
    expect(elementsOf(slidesMap(doc).get(id)!).get("body")!.get("build")).toBeNull();
    expect(() => setBuild(doc, id, "nope", 2)).not.toThrow();
    expect(() => setBuild(doc, "missing", "body", 2)).not.toThrow();
  });

  it("leaves a deck with no builds snapshotting as before", () => {
    const { doc } = setup();
    for (const e of snapshotDeck(doc).slides[0].elements) expect(Object.keys(e).sort()).toEqual(["alt", "blocks", "id", "kind", "slot", "src", "textStyle", "z"]);
  });
});
