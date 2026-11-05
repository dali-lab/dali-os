// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addFreeImage, addShape, addTextBox, groupElements, setLocked } from "~/components/slides/deck/freeform-ops";
import { initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { barSpot, FreeformLayer, type FreeformLayerProps } from "../FreeformLayer";

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

  it("does not enter text editing on a click on the selected text box, only on a double click", () => {
    const { doc, slideId, slide } = setup();
    const id = addTextBox(doc, slideId)!;
    const props = mount({ slide: slide(), selection: [id] });
    fire(hit(id), "pointerdown", { clientX: 480, clientY: 270 });
    fire(window, "pointerup", { clientX: 480, clientY: 270 });
    expect(props.onEdit).toHaveBeenLastCalledWith(null);
    fire(hit(id), "dblclick", { clientX: 480, clientY: 270 });
    expect(props.onActivate).toHaveBeenCalledWith(id, { x: 480, y: 270 });
  });

  it("draws an outline around the element under the pointer and none once it is selected", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide() });
    fire(hit(id), "pointerover");
    fire(hit(id), "pointerover");
    expect(container.querySelector("[data-hover-outline]")).not.toBeNull();
    mount({ ...props, slide: slide(), selection: [id] });
    expect(container.querySelector("[data-hover-outline]")).toBeNull();
  });

  it("drags with Option held as a duplicate: originals stay and the commit asks for a copy", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide(), selection: [id] });
    fire(hit(id), "pointerdown", { clientX: 240, clientY: 135, altKey: true });
    fire(window, "pointermove", { clientX: 300, clientY: 135, altKey: true });
    expect(props.onLive).not.toHaveBeenCalled();
    expect(container.querySelector("[data-duplicate-ghost]")).not.toBeNull();
    fire(window, "pointerup", { clientX: 300, clientY: 135 });
    expect(props.onCommit).toHaveBeenCalledWith(expect.objectContaining({ [id]: expect.any(Object) }), { duplicate: true });
  });

  it("locks the axis of a drag with Shift", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide(), selection: [id], prefs: { items: false, margins: false, grid: false } });
    const start = snapshotDeck(doc).slides[0].elements.find((e) => e.id === id)!;
    fire(hit(id), "pointerdown", { clientX: 240, clientY: 135 });
    fire(window, "pointermove", { clientX: 340, clientY: 160, shiftKey: true });
    const live = (props.onLive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Map<string, { x: number; y: number }>;
    expect(live.get(id)!.y).toBe(start.y);
    expect(live.get(id)!.x).not.toBe(start.x);
  });

  it("selects a locked element but never starts a drag, resize or rotate on it", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    setLocked(doc, slideId, [id], true);
    const props = mount({ slide: slide(), selection: [id] });
    fire(hit(id), "pointerdown", { clientX: 240, clientY: 135 });
    fire(window, "pointermove", { clientX: 300, clientY: 135 });
    fire(window, "pointerup", { clientX: 300, clientY: 135 });
    expect(props.onLive).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(container.querySelector("[data-handle]")).toBeNull();
  });

  it("shows a lock badge on a hovered locked element", () => {
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    setLocked(doc, slideId, [id], true);
    mount({ slide: slide() });
    expect(container.querySelector("[data-lock-badge]")).toBeNull();
    fire(hit(id), "pointerover");
    expect(container.querySelector("[data-lock-badge]")).not.toBeNull();
  });

  it("shows distances to another element while Option is held over it", () => {
    const { doc, slideId, slide } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    const b = addShape(doc, slideId, "rect", { x: 1300, y: 300 })!;
    mount({ slide: slide(), selection: [a] });
    fire(hit(b), "pointerover");
    expect(container.querySelector("[data-gap]")).toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })));
    expect(container.querySelector("[data-gap]")).not.toBeNull();
  });

  it("adjusts the crop from a handle while cropping and commits geometry with the crop", () => {
    const { doc, slideId, slide } = setup();
    const id = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const props = mount({ slide: slide(), selection: [id], cropId: id });
    expect(container.querySelector("[data-crop-ghost]")).not.toBeNull();
    expect(container.querySelector("[data-handle=rotate]")).toBeNull();
    const handle = container.querySelector("[data-handle=e]")!;
    fire(handle, "pointerdown", { clientX: 700, clientY: 270 });
    fire(window, "pointermove", { clientX: 600, clientY: 270 });
    fire(window, "pointerup", { clientX: 600, clientY: 270 });
    const committed = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Record<string, { crop: { r: number } | null; w: number }>;
    expect(committed[id].crop!.r).toBeGreaterThan(0);
    expect(committed[id].w).toBeLessThan(720);
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


describe("zoomed stage", () => {
  it("maps pointer travel to slide units by the size the layer is drawn at", () => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 3840, height: 2160, right: 3840, bottom: 2160, x: 0, y: 0, toJSON: () => ({}) });
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 480, y: 270 })!;
    const props = mount({ slide: slide(), selection: [id], prefs: { items: false, margins: false, grid: false } });
    const start = snapshotDeck(doc).slides[0].elements.find((e) => e.id === id)!;
    fire(hit(id), "pointerdown", { clientX: 1000, clientY: 1000 });
    fire(window, "pointermove", { clientX: 1200, clientY: 1000 });
    const live = (props.onLive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Map<string, { x: number }>;
    expect(live.get(id)!.x).toBeCloseTo(start.x! + 100);
  });

  it("starts a marquee at the unit under the pointer at any zoom", () => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: -500, top: 0, width: 3840, height: 2160, right: 3340, bottom: 2160, x: -500, y: 0, toJSON: () => ({}) });
    const { doc, slideId, slide } = setup();
    const id = addShape(doc, slideId, "rect", { x: 100, y: 100 })!;
    const props = mount({ slide: slide() });
    const layer = container.querySelector("[data-freeform-layer]")!;
    fire(layer, "pointerdown", { clientX: -500, clientY: 0 });
    fire(window, "pointermove", { clientX: 500, clientY: 500 });
    expect(props.onSelect).toHaveBeenLastCalledWith([id]);
  });
});

describe("format bar position", () => {
  it("sits above a frame and below one near the top, kept off the slide's sides", () => {
    expect(barSpot({ x: 800, y: 500, w: 320, h: 100 })).toMatchObject({ left: "50%", transform: "translate(-50%, calc(-100% - 44px))" });
    expect(barSpot({ x: 800, y: 40, w: 320, h: 100 }).transform).toBe("translate(-50%, 14px)");
    expect(barSpot({ x: 1800, y: 500, w: 100, h: 100 }).left).toBe("80%");
    expect(barSpot({ x: 0, y: 500, w: 100, h: 100 }).left).toBe("20%");
  });
});
