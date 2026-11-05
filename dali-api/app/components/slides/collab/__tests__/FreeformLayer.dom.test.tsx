// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addShape, addTextBox, groupElements } from "~/components/slides/deck/freeform-ops";
import { initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { FreeformLayer, type FreeformLayerProps } from "../FreeformLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function setup(layout = "blank") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}

function mount(over: Partial<FreeformLayerProps> & Pick<FreeformLayerProps, "slide">) {
  const props: FreeformLayerProps = {
    selection: [],
    onSelect: vi.fn(),
    editingId: null,
    onEdit: vi.fn(),
    prefs: { items: true, margins: true, grid: false },
    armed: null,
    onPlace: vi.fn(),
    onLive: vi.fn(),
    onCommit: vi.fn(),
    onActivate: vi.fn(),
    ...over,
  };
  act(() => root.render(createElement(FreeformLayer, props)));
  return props;
}

const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  });
const hit = (id: string) => container.querySelector(`[data-hit="${id}"]`)!;

describe("FreeformLayer gestures", () => {
  it("shows a drag live and writes once on pointerup", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide(), selection: [id] });
    const before = snapshotDeck(doc).slides[0].elements.find((e) => e.id === id)!;
    fire(hit(id), "pointerdown", { clientX: 240, clientY: 135 });
    fire(window, "pointermove", { clientX: 260, clientY: 135 });
    fire(window, "pointermove", { clientX: 300, clientY: 145 });
    expect(props.onLive).toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
    const live = (props.onLive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Map<string, { x: number; y: number }>;
    expect(live.get(id)!.x).toBeGreaterThan(before.x!);
    expect(snapshotDeck(doc).slides[0].elements.find((e) => e.id === id)!.x).toBe(before.x);
    fire(window, "pointerup", { clientX: 300, clientY: 145 });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const updates = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, { x: number }>;
    expect(Object.keys(updates)).toEqual([id]);
    expect((props.onLive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toBeNull();
  });

  it("treats a press without travel as a click: selects, writes nothing", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect")!;
    const props = mount({ slide: slide() });
    fire(hit(id), "pointerdown", { clientX: 480, clientY: 270 });
    fire(window, "pointerup", { clientX: 481, clientY: 270 });
    expect(props.onSelect).toHaveBeenCalledWith([id]);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("enters text editing on a click on the selected text box", () => {
    const { doc, slideId, slide } = setup();
    const id = addTextBox(doc, slideId)!;
    const props = mount({ slide: slide(), selection: [id] });
    fire(hit(id), "pointerdown", { clientX: 480, clientY: 270 });
    fire(window, "pointerup", { clientX: 480, clientY: 270 });
    expect(props.onEdit).toHaveBeenLastCalledWith(id);
  });

  it("lets pointer events through to the editor of the text box being edited", () => {
    const { doc, slideId, slide } = setup();
    const id = addTextBox(doc, slideId)!;
    mount({ slide: slide(), selection: [id], editingId: id });
    expect(hit(id).className).toContain("pointer-events-none");
  });

  it("shift-click toggles an item in the selection without dragging", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 600 })!;
    const props = mount({ slide: slide(), selection: [a] });
    fire(hit(b), "pointerdown", { clientX: 450, clientY: 300, shiftKey: true });
    expect(props.onSelect).toHaveBeenCalledWith([a, b]);
    mount({ slide: slide(), selection: [a, b], onSelect: props.onSelect });
    fire(hit(b), "pointerdown", { clientX: 450, clientY: 300, shiftKey: true });
    expect(props.onSelect).toHaveBeenLastCalledWith([a]);
  });

  it("drags a whole multi-selection together in one commit", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 600 })!;
    const props = mount({ slide: slide(), selection: [a, b] });
    fire(hit(a), "pointerdown", { clientX: 150, clientY: 150 });
    fire(window, "pointermove", { clientX: 190, clientY: 150 });
    fire(window, "pointerup", { clientX: 190, clientY: 150 });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(Object.keys((props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0]).sort()).toEqual([a, b].sort());
  });

  it("selects a group when any child is clicked", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 600 })!;
    const g = groupElements(doc, slideId, [a, b])!;
    const props = mount({ slide: slide() });
    fire(hit(b), "pointerdown", { clientX: 450, clientY: 300 });
    fire(window, "pointerup", { clientX: 450, clientY: 300 });
    expect(props.onSelect).toHaveBeenCalledWith([g]);
  });

  it("resizes from a handle and rotates from the rotate handle", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide(), selection: [id] });
    const se = container.querySelector("[data-handle='se']")!;
    fire(se, "pointerdown", { clientX: 360, clientY: 210 });
    fire(window, "pointermove", { clientX: 400, clientY: 230 });
    fire(window, "pointerup", { clientX: 400, clientY: 230 });
    const resized = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0][id];
    expect(resized.w).toBeGreaterThan(480);
    const rot = container.querySelector("[data-handle='rotate']")!;
    fire(rot, "pointerdown", { clientX: 240, clientY: 100 });
    fire(window, "pointermove", { clientX: 400, clientY: 135 });
    expect(container.querySelector("[data-rotate-badge]")).not.toBeNull();
    fire(window, "pointerup", { clientX: 400, clientY: 135 });
    const rotated = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[1][0][id];
    expect(rotated.rot).not.toBe(0);
  });

  it("draws guides, spacing pills and a position chip while dragging, and removes them after", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    addShape(doc, slideId, "rect", { x: 1000, y: 330 });
    mount({ slide: slide(), selection: [a] });
    fire(hit(a), "pointerdown", { clientX: 150, clientY: 150 });
    fire(window, "pointermove", { clientX: 250, clientY: 155 });
    expect(container.querySelector("[data-readout]")!.textContent).toMatch(/^X \d+ · Y \d+$/);
    expect(container.querySelector("[data-gap]")).not.toBeNull();
    fire(window, "pointerup", { clientX: 250, clientY: 155 });
    expect(container.querySelector("[data-readout]")).toBeNull();
    expect(container.querySelector("[data-guide]")).toBeNull();
  });

  it("skips snapping when command is held", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const props = mount({ slide: slide(), selection: [a] });
    fire(hit(a), "pointerdown", { clientX: 150, clientY: 150 });
    fire(window, "pointermove", { clientX: 189, clientY: 150, metaKey: true });
    const live = (props.onLive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Map<string, { x: number }>;
    const start = snapshotDeck(doc).slides[0].elements.find((e) => e.id === a)!.x!;
    expect(live.get(a)!.x).toBe(start + 78);
    fire(window, "pointerup", {});
  });

  it("selects what a marquee covers, adds with shift, and clears on an empty click", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 1500, y: 900 })!;
    const props = mount({ slide: slide() });
    const layer = container.querySelector("[data-freeform-layer]")!;
    fire(layer, "pointerdown", { clientX: 5, clientY: 5 });
    fire(window, "pointermove", { clientX: 300, clientY: 300 });
    expect(container.querySelector("[data-marquee]")).not.toBeNull();
    expect((props.onSelect as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toEqual([a]);
    fire(window, "pointerup", {});
    expect(container.querySelector("[data-marquee]")).toBeNull();
    expect(b).toBeDefined();
    fire(layer, "pointerdown", { clientX: 900, clientY: 20 });
    fire(window, "pointerup", {});
    expect(props.onSelect).toHaveBeenLastCalledWith([]);
  });

  it("places the armed tool where the slide is clicked", () => {
    const { slide } = setup();
    const armed = { type: "text" as const };
    const props = mount({ slide: slide(), armed });
    fire(container.querySelector("[data-freeform-layer]")!, "pointerdown", { clientX: 480, clientY: 270 });
    expect(props.onPlace).toHaveBeenCalledWith(armed, { x: 960, y: 540 });
  });

  it("marks a detached slot element as freeform", () => {
    const { doc, slideId, slide } = setup("content");
    const body = slide().elements.find((e) => e.id === "body")!;
    expect(body).toBeDefined();
    const withGeo = { ...slide(), elements: slide().elements.map((e) => (e.id === "body" ? { ...e, x: 100, y: 100, w: 400, h: 300, rot: -3 } : e)) };
    mount({ slide: withGeo, selection: ["body"] });
    expect(container.querySelector("[data-freeform-badge]")!.textContent).toBe("Freeform −3°");
    expect(slidesMap(doc).get(slideId)).toBeDefined();
  });
});
