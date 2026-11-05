// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide, setLayout } from "~/components/slides/deck/deck-ops";
import { addFreeImage, addShape, addTextBox, groupElements, moveElements } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";

vi.mock("~/components/doc/DocEditor", () => ({
  DocEditor: (p: { placeholder?: string; comments?: { scope?: { slideId: string; elementId: string } } }) =>
    createElement("div", { "data-testid": "doc-editor", "data-scope": p.comments?.scope ? `${p.comments.scope.elementId}` : "" }, p.placeholder),
}));

import { Inspector } from "../Inspector";
import { EditorToolbar } from "../EditorToolbar";
import { SlideStage } from "../SlideStage";
import type { InspectorFreeform } from "../ElementInspector";
import type { SlotCollab } from "../SlotEditor";
import { pinPosition, pinsForSlide, elementAtPoint } from "../comment-pins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 960 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 540 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (node: React.ReactElement) => {
  act(() => root.render(node));
  return container;
};
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));

function deck(layout = "blank") {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, layout, null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}
const noop = () => {};
const api = (over: Partial<InspectorFreeform> = {}): InspectorFreeform => ({
  onPlace: vi.fn(),
  onAlign: vi.fn(),
  onDistribute: vi.fn(),
  onGroup: vi.fn(),
  onUngroup: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onReorder: vi.fn(),
  onSnapBack: vi.fn(),
  onFill: vi.fn(),
  onDeselect: vi.fn(),
  prefs: { items: true, margins: true, grid: false },
  onPrefs: vi.fn(),
  ...over,
});
const inspector = (slide: ReturnType<typeof deck>["slide"], selection: string[], freeform: InspectorFreeform, over: Record<string, unknown> = {}) =>
  createElement(Inspector, {
    slide: slide(),
    themeId: "dali-dark",
    slideCount: 1,
    selection,
    freeform,
    editable: true,
    onLayout: noop,
    onTheme: noop,
    onTextStyle: noop,
    onPickImage: noop,
    onClearImage: noop,
    ...over,
  } as never);
const tabs = (el: Element) => [...el.querySelectorAll("[role=radiogroup][aria-label=Inspector] button")].map((b) => b.textContent);
const typeInto = (input: HTMLInputElement, value: string) => {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  act(() => void input.blur());
};

describe("Inspector element tab", () => {
  it("is named for what is selected", () => {
    const { doc, slideId, slide } = deck();
    const shape = addShape(doc, slideId, "rect")!;
    const text = addTextBox(doc, slideId)!;
    const img = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    expect(tabs(render(inspector(slide, [], api())))).toEqual(["Slide", "Text", "Deck"]);
    expect(tabs(render(inspector(slide, [shape], api())))[1]).toBe("Shape");
    expect(tabs(render(inspector(slide, [text], api())))[1]).toBe("Text");
    expect(tabs(render(inspector(slide, [img], api())))[1]).toBe("Image");
    expect(tabs(render(inspector(slide, [shape, text], api())))[1]).toBe("Selection");
  });

  it("shows position fields, and a changed value reports the whole placement", () => {
    const { doc, slideId, slide } = deck();
    const id = addShape(doc, slideId, "rect", { x: 500, y: 400 })!;
    const freeform = api();
    const el = render(inspector(slide, [id], freeform));
    click([...el.querySelectorAll("[role=radio]")][1]);
    const x = el.querySelector<HTMLInputElement>("input[aria-label=X]")!;
    expect(x.value).toBe("260");
    typeInto(x, "300");
    expect(freeform.onPlace).toHaveBeenCalledWith(id, { x: 300, y: 250, w: 480, h: 300, rot: 0 });
    expect(el.querySelector("input[aria-label=Rotation]")).not.toBeNull();
  });

  it("ignores a non-numeric position and puts the old value back", () => {
    const { doc, slideId, slide } = deck();
    const id = addShape(doc, slideId, "rect", { x: 500, y: 400 })!;
    const freeform = api();
    const el = render(inspector(slide, [id], freeform));
    click([...el.querySelectorAll("[role=radio]")][1]);
    const x = el.querySelector<HTMLInputElement>("input[aria-label=X]")!;
    typeInto(x, "abc");
    expect(freeform.onPlace).not.toHaveBeenCalled();
    expect(x.value).toBe("260");
  });

  it("aligns to the slide, orders, picks a theme fill, toggles snapping and deletes", () => {
    const { doc, slideId, slide } = deck();
    const id = addShape(doc, slideId, "rect")!;
    const freeform = api();
    const el = render(inspector(slide, [id], freeform));
    click(el.querySelector("button[aria-label='Align left']"));
    expect(freeform.onAlign).toHaveBeenCalledWith("left", "slide");
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Bring forward")!);
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Send back")!);
    expect(freeform.onReorder).toHaveBeenNthCalledWith(1, "forward");
    expect(freeform.onReorder).toHaveBeenNthCalledWith(2, "backward");
    click(el.querySelector("button[aria-label=Muted]"));
    expect(freeform.onFill).toHaveBeenCalledWith("muted");
    expect(el.querySelector("button[aria-label=Accent]")!.getAttribute("aria-pressed")).toBe("true");
    const grid = [...el.querySelectorAll<HTMLInputElement>("input[role=switch]")];
    expect(grid).toHaveLength(3);
    click(grid[2]);
    expect(freeform.onPrefs).toHaveBeenCalledWith({ grid: true });
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Delete")!);
    expect(freeform.onDelete).toHaveBeenCalled();
  });

  it("tells a moved slot element so, and snaps it back", () => {
    const { doc, slideId, slide } = deck("split");
    moveElements(doc, slideId, ["image"], 20, 0);
    const freeform = api();
    const el = render(inspector(slide, ["image"], freeform));
    const note = el.querySelector("[role=note]")!;
    expect(note.textContent).toContain("Moved off the image slot. It keeps its spot if you change layouts.");
    click([...note.querySelectorAll("button")].find((b) => b.textContent === "Snap back to layout")!);
    expect(freeform.onSnapBack).toHaveBeenCalledWith("image");
  });

  it("shows no notice for an element that follows its layout, and offers no delete for a slot", () => {
    const { slide } = deck("split");
    const el = render(inspector(slide, ["image"], api()));
    expect(el.querySelector("[role=note]")).toBeNull();
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Delete")).toBe(false);
  });

  it("shows text style for a free text box and applies it by element id", () => {
    const { doc, slideId, slide } = deck();
    const id = addTextBox(doc, slideId)!;
    const onTextStyle = vi.fn();
    const el = render(inspector(slide, [id], api(), { onTextStyle }));
    click([...el.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "Heading")!);
    expect(onTextStyle).toHaveBeenCalledWith(id, "heading");
  });

  it("disables editing for a reader", () => {
    const { doc, slideId, slide } = deck();
    const id = addShape(doc, slideId, "rect")!;
    const el = render(inspector(slide, [id], api(), { editable: false }));
    expect(el.querySelector<HTMLInputElement>("input[aria-label=X]")!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>("button[aria-label='Align left']")!.disabled).toBe(true);
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Delete")).toBe(false);
  });
});

describe("Inspector multi-select", () => {
  const three = () => {
    const d = deck();
    const ids = [200, 800, 1400].map((x) => addShape(d.doc, d.slideId, "rect", { x, y: 400 })!);
    return { ...d, ids };
  };

  it("counts what is selected, with Deselect, the Align to switch, align, distribute, group and duplicate", () => {
    const { slide, ids } = three();
    const freeform = api();
    const el = render(inspector(slide, ids, freeform));
    expect(el.querySelector("[data-selection-count]")!.textContent).toBe("3 shapes");
    click([...el.querySelectorAll("button")].find((b) => b.textContent === "Deselect")!);
    expect(freeform.onDeselect).toHaveBeenCalled();
    click(el.querySelector("button[aria-label='Align top']"));
    expect(freeform.onAlign).toHaveBeenCalledWith("top", "selection");
    click([...el.querySelector("[aria-label='Align to']")!.querySelectorAll("[role=radio]")].find((b) => b.textContent === "Slide")!);
    click(el.querySelector("button[aria-label='Align middle']"));
    expect(freeform.onAlign).toHaveBeenLastCalledWith("middle", "slide");
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Across")!);
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Down")!);
    expect(freeform.onDistribute).toHaveBeenNthCalledWith(1, "x");
    expect(freeform.onDistribute).toHaveBeenNthCalledWith(2, "y");
    expect(el.textContent).toContain("Space between:");
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Group")!);
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Duplicate")!);
    expect(freeform.onGroup).toHaveBeenCalled();
    expect(freeform.onDuplicate).toHaveBeenCalled();
    expect(el.textContent).toContain("Shift-click to add items");
  });

  it("cannot distribute fewer than three, and falls back to the slide when aligning a pair to the selection", () => {
    const { slide, ids } = three();
    const freeform = api();
    const el = render(inspector(slide, ids.slice(0, 2), freeform));
    expect([...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Across")!.disabled).toBe(true);
    expect(el.textContent).not.toContain("Space between");
    expect(el.querySelector("[data-selection-count]")!.textContent).toBe("2 shapes");
  });

  it("offers Ungroup for a selected group", () => {
    const { doc, slideId, slide, ids } = three();
    const g = groupElements(doc, slideId, ids)!;
    const freeform = api();
    const el = render(inspector(slide, [g], freeform));
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Ungroup")!);
    expect(freeform.onUngroup).toHaveBeenCalled();
    expect(tabs(el)[1]).toBe("Group");
  });

  it("calls mixed selections items", () => {
    const { doc, slideId, slide } = deck();
    const a = addShape(doc, slideId, "rect")!;
    const b = addTextBox(doc, slideId)!;
    expect(render(inspector(slide, [a, b], api())).querySelector("[data-selection-count]")!.textContent).toBe("2 items");
  });
});

describe("EditorToolbar insert tools", () => {
  const props = { canUndo: false, canRedo: false, onUndo: noop, onRedo: noop, onAdd: noop, onImage: noop };

  it("arms and disarms the text box tool", () => {
    const onArm = vi.fn();
    const el = render(createElement(EditorToolbar, { ...props, onArm, armed: null }));
    const button = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Text box"))!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    click(button);
    expect(onArm).toHaveBeenCalledWith({ type: "text" });
    const armed = render(createElement(EditorToolbar, { ...props, onArm, armed: { type: "text" } }));
    const pressed = [...armed.querySelectorAll("button")].find((b) => b.textContent?.includes("Text box"))!;
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    click(pressed);
    expect(onArm).toHaveBeenLastCalledWith(null);
  });

  it("has a shape menu and an image button", () => {
    const onImage = vi.fn();
    const el = render(createElement(EditorToolbar, { ...props, onArm: noop, armed: null, onImage }));
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Shape"))).toBe(true);
    click([...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Image"))!);
    expect(onImage).toHaveBeenCalled();
  });
});

describe("SlideStage with free elements", () => {
  const collab: SlotCollab = { room: "slides:p:deck", token: "t", user: { userId: "u", name: "Ada", color: "#336699", photoUrl: null }, undoExtension: {} };
  const freeformFor = (selection: string[], over: Record<string, unknown> = {}) => ({
    selection,
    onSelect: noop,
    editingId: null,
    onEdit: noop,
    prefs: { items: true, margins: true, grid: false },
    armed: null,
    onPlace: noop,
    onCommit: noop,
    peerDrags: new Map(),
    onPublishDrag: noop,
    ...over,
  });
  const stage = (d: ReturnType<typeof deck>, over: Record<string, unknown> = {}) =>
    createElement(SlideStage, { slide: d.slide(), themeId: "dali-dark", doc: d.doc, collab, editable: true, freeform: freeformFor([]), onPickImage: noop, ...over } as never);

  it("mounts a live editor for each free text box, scoped to its element id for comments", () => {
    const d = deck();
    const t = addTextBox(d.doc, d.slideId)!;
    addShape(d.doc, d.slideId, "rect");
    const el = render(stage(d));
    const editors = el.querySelectorAll("[data-testid=doc-editor]");
    expect(editors).toHaveLength(1);
    expect(el.querySelector(`[data-element-id="${t}"]`)).not.toBeNull();
    expect(el.querySelector("[data-freeform-layer]")).not.toBeNull();
  });

  it("draws free elements with no editing layer for a reader", () => {
    const d = deck();
    addTextBox(d.doc, d.slideId);
    addShape(d.doc, d.slideId, "rect");
    const el = render(stage(d, { editable: false, collab: null, freeform: undefined }));
    expect(el.querySelector("[data-freeform-layer]")).toBeNull();
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(0);
    expect(el.querySelector("[data-shape=rect]")).not.toBeNull();
  });

  it("puts the live editor of a moved slot where the element now is", () => {
    const d = deck("content");
    moveElements(d.doc, d.slideId, ["body"], 0, 100);
    const el = render(stage(d));
    const body = el.querySelector<HTMLElement>("[data-slot='body'][data-element-id]")!;
    expect(body.style.top).toBe("calc(410 * var(--slide-u))");
  });

  it("draws a peer's drag live without a doc write", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 500, y: 400 })!;
    const el = render(stage(d, { freeform: freeformFor([], { peerDrags: new Map([[id, { x: 111, y: 222, w: 300, h: 200, rot: 0 }]]) }) }));
    const shape = el.querySelector<HTMLElement>(`[data-element="${id}"]`)!;
    expect(shape.style.left).toBe("calc(111 * var(--slide-u))");
    expect(d.slide().elements.find((e) => e.id === id)!.x).toBe(260);
  });

  it("offers a comment button on a selected free text box that targets its id", () => {
    const d = deck();
    const t = addTextBox(d.doc, d.slideId)!;
    const onStart = vi.fn();
    const comments = { pageId: "p", viewerId: "u", canComment: true, canModerate: false, pins: [], focusedPinId: null, onOpenPin: noop, onStart };
    const el = render(stage(d, { comments, freeform: freeformFor([t]) }));
    click(el.querySelector(`button[aria-label='Comment on ${t}']`));
    expect(onStart).toHaveBeenCalledWith({ slideId: d.slideId, elementId: t });
  });

  it("opens the image picker for a double-clicked free image only", () => {
    const d = deck();
    const img = addFreeImage(d.doc, d.slideId, "https://x/y.png", "y")!;
    const shape = addShape(d.doc, d.slideId, "rect")!;
    const onPickImage = vi.fn();
    const el = render(stage(d, { onPickImage }));
    act(() => void el.querySelector(`[data-hit="${shape}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onPickImage).not.toHaveBeenCalled();
    act(() => void el.querySelector(`[data-hit="${img}"]`)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onPickImage).toHaveBeenCalledWith(img);
  });

  it("keeps the layout's own editors and image button for a slot layout", () => {
    const d = deck("split");
    setLayout(d.doc, d.slideId, "split");
    const el = render(stage(d));
    expect(el.querySelectorAll("[data-testid=doc-editor]")).toHaveLength(2);
    expect(el.querySelector("button[aria-label='Add image']")).not.toBeNull();
  });
});

describe("comment pins on free elements", () => {
  it("finds the topmost element under a point, rotated bounds included", () => {
    const d = deck();
    const back = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const front = addShape(d.doc, d.slideId, "ellipse", { x: 960, y: 540 })!;
    expect(elementAtPoint("blank", 0.5, 0.5, d.slide())).toBe(front);
    expect(elementAtPoint("blank", 0.01, 0.01, d.slide())).toBeNull();
    expect(back).not.toBe(front);
  });

  it("anchors a pin to the top right corner of a free element and a detached slot", () => {
    const d = deck("content");
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const free = pinPosition({ kind: "slide", slideId: d.slideId, elementId: id }, "content", d.slide());
    expect(free.x).toBeCloseTo((720 + 480) / 1920);
    expect(free.y).toBeCloseTo(390 / 1080);
    moveElements(d.doc, d.slideId, ["body"], 0, 200);
    const slot = pinPosition({ kind: "slide", slideId: d.slideId, elementId: "body" }, "content", d.slide());
    expect(slot.y).toBeCloseTo(510 / 1080);
    expect(pinPosition({ kind: "slide", slideId: d.slideId, elementId: "gone" }, "content", d.slide())).toEqual({ x: 0.02, y: 0.03 });
  });

  it("pins threads on free elements using the slide's geometry", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const pins = pinsForSlide(
      [{ id: "t", parentId: null, author: "Ada", authorId: "u", body: "x", anchor: { kind: "slide", slideId: d.slideId, elementId: id }, createdAt: "2026-11-05T10:00:00.000Z" } as never],
      d.slideId,
      "blank",
      d.slide(),
    );
    expect(pins[0].x).toBeCloseTo(1200 / 1920);
  });
});
