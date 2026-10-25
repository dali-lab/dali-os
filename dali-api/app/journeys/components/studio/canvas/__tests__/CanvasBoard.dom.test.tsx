// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CanvasItem, Hotspot } from "~/journeys/lib/studio-types";

vi.mock("~/components/doc", () => ({ IMAGE_UPLOAD_ACCEPT: "image/*", uploadEditorImage: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));

import { CanvasBoard, type CanvasBoardOptions } from "../CanvasBoard";
import { isTyping } from "../canvas-geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub {
  observe() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
HTMLElement.prototype.setPointerCapture = () => {};

let container: HTMLDivElement;
let root: Root;
let latest: { items: CanvasItem[]; hotspots: Hotspot[] };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type HarnessProps = Omit<CanvasBoardOptions, "items" | "hotspots" | "onItemsChange" | "onHotspotsChange"> & {
  initial: CanvasItem[];
  initialHotspots?: Hotspot[];
};

function Harness({ initial, initialHotspots = [], ...rest }: HarnessProps) {
  const [items, setItems] = useState(initial);
  const [hotspots, setHotspots] = useState(initialHotspots);
  latest = { items, hotspots };
  return createElement(CanvasBoard, { ...rest, items, onItemsChange: setItems, hotspots, onHotspotsChange: setHotspots });
}

const render = (props: HarnessProps) => act(() => root.render(createElement(Harness, props)));
const sticky = (extra: Partial<CanvasItem> = {}): CanvasItem => ({ id: "s1", type: "sticky", x: 0, y: 0, width: 100, height: 100, text: "Hi", ...extra });
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key })));
const board = () => container.querySelector<HTMLElement>('[aria-label="Whiteboard"]')!;
const node = (id: string) => container.querySelector(`[data-node-id="${id}"]`)!;
// jsdom has no PointerEvent; React's onPointerDown listens for the event name, so a MouseEvent works.
const pointerDown = (el: Element, x = 5, y = 5) =>
  act(() => void el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y })));

describe("CanvasBoard", () => {
  it("places a sticky note with the S tool and a click", () => {
    render({ mode: "learner", initial: [] });
    press("s");
    pointerDown(board(), 50, 50);
    expect(latest.items).toHaveLength(1);
    expect(latest.items[0]).toMatchObject({ type: "sticky", color: "yellow" });
  });

  it("hides editor-only tools from learners", () => {
    render({ mode: "learner", initial: [] });
    expect(container.querySelector('[aria-label="Image (I)"]')).toBeNull();
    expect(container.querySelector('[aria-label="Hidden problem area (H)"]')).toBeNull();
    press("h");
    pointerDown(board());
    expect(latest.hotspots).toHaveLength(0);
  });

  it("places hotspots for editors", () => {
    render({ mode: "editor", initial: [], showHotspots: true });
    press("h");
    pointerDown(board(), 40, 40);
    expect(latest.hotspots).toHaveLength(1);
  });

  it("deletes the selected item with Delete", () => {
    render({ mode: "learner", initial: [sticky()] });
    pointerDown(node("s1"));
    press("Delete");
    expect(latest.items).toEqual([]);
  });

  it("won't let a learner delete a starter item", () => {
    render({ mode: "learner", initial: [sticky({ fromStarter: true })] });
    pointerDown(node("s1"));
    press("Delete");
    expect(latest.items).toHaveLength(1);
  });

  it("changes nothing when read-only, and shows no toolbar", () => {
    render({ mode: "editor", readOnly: true, initial: [sticky()] });
    expect(container.querySelector('[aria-label="Board tools"]')).toBeNull();
    pointerDown(node("s1"));
    press("Delete");
    press("s");
    pointerDown(board());
    expect(latest.items).toHaveLength(1);
  });

  it("lets editors lock an item for learners", () => {
    render({ mode: "editor", initial: [sticky()] });
    pointerDown(node("s1"));
    const lock = container.querySelector<HTMLButtonElement>('button[aria-label^="Learners can move this"]')!;
    act(() => lock.click());
    expect(latest.items[0].locked).toBe(true);
  });

  it("shows hotspots only when asked, marking found ones", () => {
    const h: Hotspot = { id: "h1", label: "Low contrast", x: 0, y: 0, width: 50, height: 50 };
    render({ mode: "learner", readOnly: true, initial: [], initialHotspots: [h] });
    expect(container.textContent).not.toContain("Low contrast");
    render({ mode: "learner", readOnly: true, initial: [], initialHotspots: [h], showHotspots: true, foundHotspotIds: new Set(["h1"]) });
    expect(container.textContent).toContain("Low contrast");
    expect(container.querySelector('[aria-label="Found"]')).not.toBeNull();
  });

  it("numbers the learner's pins", () => {
    render({ mode: "learner", initial: [{ id: "p1", type: "pin", x: 0, y: 0 }, { id: "p2", type: "pin", x: 40, y: 0 }] });
    expect(container.querySelector('[aria-label="Comment 2"]')).not.toBeNull();
  });

  it("treats inputs and textareas as typing", () => {
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("div"))).toBe(false);
  });
});
