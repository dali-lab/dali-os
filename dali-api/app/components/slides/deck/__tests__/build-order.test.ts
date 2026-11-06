import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyBuildPatches, addSlide, setBuildEffect } from "../deck-ops";
import { buildRows, elementLabel, planBuilds, reorderRows, REMOVED, withoutRow } from "../build-order";
import { buildSteps } from "../builds";
import { createDeckUndo } from "../deck-undo";
import { addShape, addTextBox } from "../freeform-ops";
import { deckMap, elementsOf, initDeck, slidesMap } from "../model";
import { snapshotDeck, type RenderElement, type RenderSlide } from "../snapshot";

const el = (id: string, extra: Partial<RenderElement> = {}): RenderElement => ({ id, kind: "shape", slot: null, z: 1, blocks: [], src: null, alt: null, textStyle: null, ...extra });
const slide = (elements: RenderElement[]): RenderSlide => ({ id: "s", pos: 1, layoutId: "blank", elements });
const row = (id: string, mode: "click" | "with" | "after", span = 1, delay = 0) => ({ id, mode, span, delay });

describe("buildRows", () => {
  it("orders by step and marks items sharing a step as with previous", () => {
    const rows = buildRows(slide([el("c", { build: 2, z: 3 }), el("a", { build: 1, z: 1 }), el("b", { build: 1, z: 2 }), el("n")]));
    expect(rows.map((r) => [r.id, r.start, r.mode])).toEqual([["a", 1, "click"], ["b", 1, "with"], ["c", 2, "click"]]);
  });

  it("marks a step that plays by itself as after previous with its delay", () => {
    const rows = buildRows(slide([el("a", { build: 1 }), el("b", { build: 2, buildAfter: true, buildDelay: 800 })]));
    expect(rows[1]).toMatchObject({ mode: "after", delay: 800 });
  });

  it("includes a with-slide bullets box at step 1 and gives it a span", () => {
    const rows = buildRows(slide([el("t", { kind: "text", buildBullets: true, blocks: [{}, {}, {}] as never })]));
    expect(rows[0]).toMatchObject({ start: 1, span: 3, bullets: true });
  });

  it("labels text by its words and other items by kind", () => {
    const text = el("t", { kind: "text", blocks: [{ type: "paragraph", content: [{ type: "text", text: "A very long heading that keeps going and going", styles: {} }], children: [] }] as never });
    expect(elementLabel(text)).toHaveLength(28);
    expect(elementLabel(text).endsWith("…")).toBe(true);
    expect(elementLabel(el("c", { kind: "chart" }))).toBe("Chart");
    expect(elementLabel(el("p", { kind: "poll", poll: { question: "Ship it?", options: ["a", "b"] } as never }))).toBe("Ship it?");
  });
});

describe("planBuilds", () => {
  it("numbers click rows one step each and shares a step for with rows", () => {
    const plan = planBuilds([row("a", "click"), row("b", "with"), row("c", "click")]);
    expect([plan.a.build, plan.b.build, plan.c.build]).toEqual([1, 1, 2]);
  });

  it("gives a bullets row one step per bullet before the next row", () => {
    const plan = planBuilds([row("a", "click", 3), row("b", "click")]);
    expect([plan.a.build, plan.b.build]).toEqual([1, 4]);
  });

  it("lets the longest item of a shared step set where the next step starts", () => {
    const plan = planBuilds([row("a", "click"), row("b", "with", 2), row("c", "click")]);
    expect(plan.c.build).toBe(3);
  });

  it("applies after previous and its delay to every item of the step", () => {
    const plan = planBuilds([row("a", "click"), row("b", "after", 1, 1200), row("c", "with")]);
    expect(plan.a).toMatchObject({ buildAfter: false, buildDelay: null });
    expect(plan.b).toMatchObject({ build: 2, buildAfter: true, buildDelay: 1200 });
    expect(plan.c).toMatchObject({ build: 2, buildAfter: true, buildDelay: 1200 });
  });

  it("clamps the delay and drops a zero delay", () => {
    expect(planBuilds([row("a", "after", 1, 99999)]).a.buildDelay).toBe(5000);
    expect(planBuilds([row("a", "after", 1, 0)]).a.buildDelay).toBeNull();
  });

  it("treats a leading with row as its own step", () => {
    expect(planBuilds([row("a", "with"), row("b", "click")])).toMatchObject({ a: { build: 1 }, b: { build: 2 } });
  });
});

describe("reorder and remove", () => {
  it("moves a row onto another's place", () => {
    expect(reorderRows([{ id: "a" }, { id: "b" }, { id: "c" }], "a", "c").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(reorderRows([{ id: "a" }], "a", "zzz")).toEqual([{ id: "a" }]);
  });

  it("hands a removed leader's start to the item sharing its step", () => {
    const left = withoutRow([row("a", "after", 1, 700), row("b", "with"), row("c", "click")], "a");
    expect(left[0]).toMatchObject({ id: "b", mode: "after", delay: 700 });
  });

  it("leaves other rows alone when a follower is removed", () => {
    expect(withoutRow([row("a", "click"), row("b", "with")], "b")).toEqual([row("a", "click")]);
  });
});

describe("applying a plan to the deck", () => {
  function setup() {
    const doc = new Y.Doc();
    initDeck(doc);
    const slideId = addSlide(doc, "blank", null);
    const ids = [addShape(doc, slideId, "rect")!, addShape(doc, slideId, "ellipse")!, addTextBox(doc, slideId)!];
    ids.forEach((id, i) => applyBuildPatches(doc, slideId, { [id]: { build: i + 1, buildAfter: false, buildDelay: null } }));
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    undo.manager.clear();
    return { doc, slideId, ids, undo, snap: () => snapshotDeck(doc).slides[0] };
  }
  const builds = (s: RenderSlide, ids: string[]) => ids.map((id) => s.elements.find((e) => e.id === id)!.build ?? 0);

  it("renumbers a reorder in one undo step", () => {
    const { doc, slideId, ids, undo, snap } = setup();
    const rows = reorderRows(buildRows(snap()), ids[0], ids[2]);
    undo.step(() => applyBuildPatches(doc, slideId, planBuilds(rows)));
    expect(builds(snap(), ids)).toEqual([3, 1, 2]);
    undo.manager.undo();
    expect(builds(snap(), ids)).toEqual([1, 2, 3]);
    expect(undo.manager.undoStack).toHaveLength(0);
  });

  it("writes after previous, delay and effect, and clears them on removal", () => {
    const { doc, slideId, ids, snap } = setup();
    applyBuildPatches(doc, slideId, planBuilds([row(ids[0], "click"), row(ids[1], "after", 1, 900)]));
    setBuildEffect(doc, slideId, ids[1], "scale");
    const b = snap().elements.find((e) => e.id === ids[1])!;
    expect(b).toMatchObject({ build: 2, buildAfter: true, buildDelay: 900, buildEffect: "scale" });
    applyBuildPatches(doc, slideId, { [ids[1]]: REMOVED });
    const gone = snap().elements.find((e) => e.id === ids[1])!;
    expect(gone.build).toBeUndefined();
    expect(gone.buildAfter).toBeUndefined();
    expect(gone.buildEffect).toBeUndefined();
    expect(buildSteps(snap())).toBe(3);
  });

  it("ignores an unknown effect and an unknown element", () => {
    const { doc, slideId, ids, snap } = setup();
    setBuildEffect(doc, slideId, ids[0], "spin" as never);
    applyBuildPatches(doc, slideId, { nope: { build: 4, buildAfter: false, buildDelay: null } });
    expect(snap().elements.find((e) => e.id === ids[0])!.buildEffect).toBeUndefined();
    expect(elementsOf(slidesMap(doc).get(slideId)!).has("nope")).toBe(false);
  });
});
