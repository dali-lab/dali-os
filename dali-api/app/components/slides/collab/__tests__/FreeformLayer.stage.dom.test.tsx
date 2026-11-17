// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { barSpot, FreeformLayer, outsetStyle, type FreeformLayerProps } from "../FreeformLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stage = { w: 3300, h: 2550 };
const slide: RenderSlide = {
  id: "s",
  pos: 0,
  layoutId: "blank",
  elements: [{ id: "a", kind: "text", slot: null, z: 0, blocks: [] as never, src: null, alt: null, textStyle: null, x: 1000, y: 500, w: 600, h: 200 }],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 660, height: 510, right: 660, bottom: 510, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function mount(over: Partial<FreeformLayerProps> = {}) {
  const props: FreeformLayerProps = {
    slide,
    selection: ["a"],
    onSelect: vi.fn(),
    editingId: null,
    prefs: { items: true, margins: true, grid: false },
    onLive: vi.fn(),
    onCommit: vi.fn(),
    stage,
    ...over,
  };
  act(() => root.render(createElement(FreeformLayer, props)));
  return props;
}

const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  });

describe("FreeformLayer on a custom stage", () => {
  it("maps pointer pixels to stage units", () => {
    const props = mount();
    const el = container.querySelector("[data-hit='a']")!;
    fire(el, "pointerdown", { clientX: 260, clientY: 120 });
    fire(window, "pointermove", { clientX: 280, clientY: 120 });
    fire(window, "pointerup", { clientX: 280, clientY: 120 });
    const out = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0].a;
    expect(out.x).toBe(1100);
    expect(out.y).toBe(500);
  });

  it("snaps to the page center", () => {
    const props = mount();
    const el = container.querySelector("[data-hit='a']")!;
    fire(el, "pointerdown", { clientX: 260, clientY: 120 });
    fire(window, "pointermove", { clientX: 326, clientY: 120 });
    fire(window, "pointerup", { clientX: 326, clientY: 120 });
    const out = (props.onCommit as ReturnType<typeof vi.fn>).mock.calls[0][0].a;
    expect(out.x + out.w / 2).toBe(1650);
  });

  it("positions hit areas as percentages of the stage", () => {
    mount();
    const el = container.querySelector<HTMLElement>("[data-hit='a']")!;
    expect(el.style.left).toBe(`${(1000 / 3300) * 100}%`);
    expect(el.style.height).toBe(`${(200 / 2550) * 100}%`);
  });

  it("hides the rotate handle when rotatable is false and keeps it by default", () => {
    mount({ rotatable: false });
    expect(container.querySelector("[data-handle=rotate]")).toBeNull();
    mount({ rotatable: undefined });
    expect(container.querySelector("[data-handle=rotate]")).not.toBeNull();
  });

  it("limits the resize handles with handlesFor", () => {
    mount({ handlesFor: () => ["e", "w"] });
    const handles = [...container.querySelectorAll("[data-handle]")].map((h) => h.getAttribute("data-handle")).filter((h) => h !== "rotate");
    expect(handles.sort()).toEqual(["e", "w"]);
  });

  it("draws the grid in 24 columns across the stage", () => {
    mount({ prefs: { items: true, margins: true, grid: true } });
    const grid = container.querySelector<HTMLElement>("[aria-hidden].pointer-events-none")!;
    const [cols, rows] = grid.style.backgroundSize.split(" ").map(parseFloat);
    expect(cols).toBeCloseTo(100 / 24, 6);
    expect(rows).toBeCloseTo((3300 / 24 / 2550) * 100, 6);
  });

  it("places the format bar by the stage height", () => {
    expect(barSpot({ x: 0, y: 400, w: 100, h: 50 }, stage).top).toBe(`${(450 / 2550) * 100}%`);
    expect(barSpot({ x: 0, y: 700, w: 100, h: 50 }, stage).top).toBe(`${(700 / 2550) * 100}%`);
    expect(barSpot({ x: 0, y: 200, w: 100, h: 50 }).top).toBe(`${(250 / 1080) * 100}%`);
    expect(barSpot({ x: 0, y: 230, w: 100, h: 50 }).top).toBe(`${(230 / 1080) * 100}%`);
  });

  it("sizes the selection frame outset from the stage", () => {
    expect(outsetStyle({ x: 330, y: 255, w: 660, h: 510 }, 1, stage).left).toBe(`calc(10% - 5px)`);
  });
});
