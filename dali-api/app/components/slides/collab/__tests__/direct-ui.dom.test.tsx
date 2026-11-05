// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addFreeImage, addShape, addTextBox, setLocked } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { stageFreeform } from "./stage-fixture";

vi.mock("~/components/doc/DocEditor", () => ({
  DocEditor: () => createElement("div", { "data-testid": "doc-editor" }),
}));
vi.mock("~/components/ui/Avatar", () => ({ Avatar: (p: { name: string }) => createElement("span", { "data-avatar": p.name }) }));

import { Filmstrip } from "../Filmstrip";
import { SlideStage } from "../SlideStage";
import type { SlotCollab } from "../SlotEditor";
import type { StageHandlers } from "../actions";

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
const rightClick = (el: Element, x = 480, y = 270) =>
  act(() => void el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })));
const rows = () => [...document.body.querySelectorAll<HTMLElement>("[role^='menuitem']")];
const row = (label: string) => rows().find((r) => r.textContent?.startsWith(label));
const collab: SlotCollab = { room: "r", token: "t", user: { userId: "u", name: "Ada", color: "#336699", photoUrl: null }, undoExtension: {} };

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  return { doc, slideId, slide: () => snapshotDeck(doc).slides[0] };
}
const stage = (d: ReturnType<typeof deck>, freeform = stageFreeform(), extra: Record<string, unknown> = {}) =>
  createElement(SlideStage, { slide: d.slide(), themeId: "dali-dark", doc: d.doc, collab, editable: true, freeform, onPickImage: () => {}, ...extra } as never);

describe("right click on the stage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
  });

  it("selects an element it lands on and offers the element menu", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const onContext = vi.fn((t: string | null) => (t ? [t] : []));
    const el = render(stage(d, stageFreeform([id], { onContext })));
    rightClick(el.querySelector(`[data-hit="${id}"]`)!);
    expect(onContext).toHaveBeenCalledWith(id);
    expect(rows().map((r) => r.textContent?.replace(/[⌘⌥⇧⌫].*$/, ""))).toEqual(expect.arrayContaining(["Cut", "Copy", "Paste", "Duplicate", "Delete", "Arrange", "Align to slide", "Lock"]));
  });

  it("runs a row on the element handlers, and opens Arrange as a submenu with shortcut hints", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const dup = vi.fn();
    const reorder = vi.fn();
    const handlers = new Proxy({ duplicate: dup, reorder }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { handlers })));
    rightClick(el.querySelector(`[data-hit="${id}"]`)!);
    click(row("Arrange")!);
    const sub = document.body.querySelector("[data-menu-sub]")!;
    expect(sub.textContent).toContain("Bring to front⇧⌘]");
    click([...sub.querySelectorAll("[role^=menuitem]")].find((r) => r.textContent?.startsWith("Send backward"))!);
    expect(reorder).toHaveBeenCalledWith("backward");
    expect(document.body.querySelector("[role=menu]")).toBeNull();
    rightClick(el.querySelector(`[data-hit="${id}"]`)!);
    click(row("Duplicate")!);
    expect(dup).toHaveBeenCalled();
  });

  it("offers the empty-space menu on the background, with the point the pointer was at", () => {
    const d = deck();
    const addText = vi.fn();
    const stageHandlers = vi.fn((): StageHandlers => ({ paste: vi.fn(), addText, addShape: vi.fn(), addImage: vi.fn(), changeLayout: vi.fn(), selectAll: vi.fn(), comment: vi.fn(), setGuides: vi.fn(), setGrid: vi.fn() }));
    const onContext = vi.fn(() => []);
    const el = render(stage(d, stageFreeform([], { stageHandlers, onContext })));
    rightClick(el.querySelector("[data-freeform-layer]")!, 480, 270);
    expect(onContext).toHaveBeenCalledWith(null);
    expect(rows().map((r) => r.textContent)).toEqual(expect.arrayContaining(["Add text box here", "Select all⌘A"]));
    expect(stageHandlers).toHaveBeenLastCalledWith({ x: 960, y: 540 });
    click(row("Add text box here")!);
    expect(addText).toHaveBeenCalled();
  });

  it("checks the current layout in Change layout and flips the grid toggle", () => {
    const d = deck();
    const setGrid = vi.fn();
    const stageHandlers = () => ({ setGrid, changeLayout: vi.fn() }) as unknown as StageHandlers;
    const el = render(stage(d, stageFreeform([], { stageHandlers })));
    rightClick(el.querySelector("[data-freeform-layer]")!);
    click(row("Change layout")!);
    const checked = [...document.body.querySelectorAll("[data-menu-sub] [aria-checked=true]")].map((n) => n.textContent);
    expect(checked).toEqual(["Blank"]);
    click(row("Show grid")!);
    expect(setGrid).toHaveBeenCalledWith(true);
  });

  it("leaves a text box that is being edited to its own native menu", () => {
    const d = deck();
    const id = addTextBox(d.doc, d.slideId)!;
    const el = render(stage(d, stageFreeform([id], { editingId: id })));
    rightClick(el.querySelector("[data-testid=doc-editor]")!);
    expect(document.body.querySelector("[role=menu]")).toBeNull();
  });

  it("hides comment rows when commenting is off and shows them when it is on", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const el = render(stage(d, stageFreeform([id])));
    rightClick(el.querySelector(`[data-hit="${id}"]`)!);
    expect(row("Comment")).toBeUndefined();
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const comments = { pageId: "p", viewerId: "u", canComment: true, canModerate: false, pins: [], focusedPinId: null, onOpenPin: () => {}, onStart: vi.fn() };
    render(stage(d, stageFreeform([id]), { comments }));
    rightClick(container.querySelector(`[data-hit="${id}"]`)!);
    expect(row("Comment")).toBeDefined();
  });
});

describe("format bar", () => {
  const bar = () => container.querySelector("[data-format-bar]");

  it("shows fill colors for a shape and applies one", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const fill = vi.fn();
    const barHandlers = new Proxy({ fill }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { barHandlers })));
    expect(bar()).not.toBeNull();
    click(el.querySelector("[data-format-bar] button[aria-label=Muted]"));
    expect(fill).toHaveBeenCalledWith("muted");
  });

  it("shows text style and format buttons for a text box and routes them", () => {
    const d = deck();
    const id = addTextBox(d.doc, d.slideId)!;
    const format = vi.fn();
    const barHandlers = new Proxy({ format }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { barHandlers })));
    for (const label of ["Bold", "Italic", "Underline", "Link", "Bulleted list"]) expect(el.querySelector(`[data-format-bar] button[aria-label='${label}']`)).not.toBeNull();
    click(el.querySelector("[data-format-bar] button[aria-label=Italic]"));
    expect(format).toHaveBeenCalledWith(id, "italic");
  });

  it("shows Replace image and Crop for an image", () => {
    const d = deck();
    const id = addFreeImage(d.doc, d.slideId, "https://x/y.png", "y")!;
    const replaceImage = vi.fn();
    const crop = vi.fn();
    const barHandlers = new Proxy({ replaceImage, crop }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { barHandlers })));
    click(el.querySelector("[data-format-bar] button[aria-label='Replace image']"));
    click(el.querySelector("[data-format-bar] button[aria-label=Crop]"));
    expect(replaceImage).toHaveBeenCalledWith(id);
    expect(crop).toHaveBeenCalledWith(id);
  });

  it("opens the same arrange rows as the context menu and the same more rows", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    const el = render(stage(d, stageFreeform([id])));
    click(el.querySelector("[data-format-bar] button[aria-label=Arrange]"));
    const arrange = rows().map((r) => r.textContent);
    expect(arrange).toEqual(["Bring to front⇧⌘]", "Bring forward⌘]", "Send backward⌘[", "Send to back⇧⌘["]);
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    click(el.querySelector("[data-format-bar] button[aria-label=More]"));
    const more = rows().map((r) => r.textContent?.replace(/[⌘⌥⇧⌫].*$/, ""));
    expect(more).toEqual(expect.arrayContaining(["Cut", "Duplicate", "Delete", "Arrange", "Lock"]));
  });

  it("offers only Unlock for a locked element", () => {
    const d = deck();
    const id = addShape(d.doc, d.slideId, "rect", { x: 960, y: 540 })!;
    setLocked(d.doc, d.slideId, [id], true);
    const unlock = vi.fn();
    const barHandlers = new Proxy({ unlock }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { barHandlers })));
    const buttons = [...el.querySelectorAll("[data-format-bar] button")].map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Unlock", "More"]);
    click(el.querySelector("[data-format-bar] button"));
    expect(unlock).toHaveBeenCalled();
  });

  it("shows Reset crop and Done while cropping", () => {
    const d = deck();
    const id = addFreeImage(d.doc, d.slideId, "https://x/y.png", "y")!;
    const resetCrop = vi.fn();
    const doneCrop = vi.fn();
    const barHandlers = new Proxy({ resetCrop, doneCrop }, { get: (t, k: string) => (t as Record<string, unknown>)[k] ?? vi.fn() }) as never;
    const el = render(stage(d, stageFreeform([id], { cropId: id, barHandlers })));
    const labels = [...el.querySelectorAll("[data-format-bar] button")].map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(labels).toEqual(["Reset crop", "Done", "More"]);
    click([...el.querySelectorAll("[data-format-bar] button")][0]);
    click([...el.querySelectorAll("[data-format-bar] button")][1]);
    expect(resetCrop).toHaveBeenCalledWith(id);
    expect(doneCrop).toHaveBeenCalled();
  });

  it("is not there while a text box is being edited, while dragging, or with nothing selected", () => {
    const d = deck();
    const id = addTextBox(d.doc, d.slideId)!;
    render(stage(d, stageFreeform([id], { editingId: id })));
    expect(bar()).toBeNull();
    render(stage(d, stageFreeform([])));
    expect(bar()).toBeNull();
    render(stage(d, stageFreeform([id], { armed: { type: "text" } })));
    expect(bar()).toBeNull();
  });
});

describe("dropping files on the stage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
  });
  const drop = (el: Element, files: File[], types = ["Files"]) => {
    const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; clientX: number; clientY: number };
    Object.assign(event, { dataTransfer: { files, types }, clientX: 240, clientY: 135 });
    act(() => void el.dispatchEvent(event));
    return event;
  };

  it("hands image files and the drop point in slide units to the editor", () => {
    const d = deck();
    const onDropFiles = vi.fn();
    const el = render(stage(d, stageFreeform([], { onDropFiles })));
    const file = new File(["x"], "a.png", { type: "image/png" });
    const event = drop(el.querySelector("[data-freeform-layer]")!, [file]);
    expect(event.defaultPrevented).toBe(true);
    expect(onDropFiles).toHaveBeenCalledWith([file], { x: 480, y: 270 });
  });

  it("ignores drops with no image in them", () => {
    const d = deck();
    const onDropFiles = vi.fn();
    const el = render(stage(d, stageFreeform([], { onDropFiles })));
    const event = drop(el.querySelector("[data-freeform-layer]")!, [new File(["x"], "a.pdf", { type: "application/pdf" })]);
    expect(event.defaultPrevented).toBe(false);
    expect(onDropFiles).not.toHaveBeenCalled();
  });
});

describe("zoom on the stage", () => {
  it("draws the slide at the zoomed width inside a scrolling box", () => {
    const d = deck();
    const el = render(stage(d, stageFreeform(), { zoom: 2, onZoom: () => {} }));
    const box = el.querySelector("[data-fit-box]") as HTMLElement;
    expect(box.className).toContain("overflow-auto");
    expect((box.firstElementChild as HTMLElement).style.width).toBe("1920px");
    const fit = render(stage(d, stageFreeform(), { zoom: 1, onZoom: () => {} }));
    expect(((fit.querySelector("[data-fit-box]") as HTMLElement).firstElementChild as HTMLElement).style.width).toBe("960px");
  });

  it("zooms from the control and shows the percentage", () => {
    const d = deck();
    const onZoom = vi.fn();
    const el = render(stage(d, stageFreeform(), { zoom: 1, onZoom }));
    const group = el.querySelector("[role=group][aria-label=Zoom]")!;
    expect(group.textContent).toContain("100%");
    click(group.querySelector("button[aria-label='Zoom in']"));
    expect(onZoom).toHaveBeenLastCalledWith(1.25);
    click(group.querySelector("button[aria-label='Zoom out']"));
    expect(onZoom).toHaveBeenLastCalledWith(0.75);
    click(group.querySelectorAll("button[aria-label='Fit to window']")[0]);
    expect(onZoom).toHaveBeenLastCalledWith(1);
  });

  it("pinches with a ctrl wheel and leaves a plain wheel to scroll", () => {
    const d = deck();
    const onZoom = vi.fn();
    const el = render(stage(d, stageFreeform(), { zoom: 1, onZoom }));
    const box = el.querySelector("[data-fit-box]")!;
    const plain = new WheelEvent("wheel", { deltaY: -20, bubbles: true, cancelable: true });
    act(() => void box.dispatchEvent(plain));
    expect(onZoom).not.toHaveBeenCalled();
    const pinch = new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void box.dispatchEvent(pinch));
    expect(pinch.defaultPrevented).toBe(true);
    expect(onZoom.mock.calls[0][0]).toBeGreaterThan(1);
  });

  it("has no zoom control without a handler", () => {
    const d = deck();
    expect(render(stage(d, stageFreeform())).querySelector("[aria-label=Zoom]")).toBeNull();
  });
});

describe("text box keys and growth", () => {
  it("steps out of editing on Escape from inside the editor", () => {
    const d = deck();
    const id = addTextBox(d.doc, d.slideId)!;
    const onEscape = vi.fn();
    const el = render(stage(d, stageFreeform([id], { editingId: id, onEscape })));
    act(() => void el.querySelector("[data-testid=doc-editor]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("filmstrip", () => {
  const slides = () => {
    const doc = new Y.Doc();
    initDeck(doc);
    const a = addSlide(doc, "blank", null);
    const b = addSlide(doc, "blank", a);
    const c = addSlide(doc, "blank", b);
    return { doc, ids: [a, b, c], list: snapshotDeck(doc).slides };
  };
  const props = (list: ReturnType<typeof slides>["list"], over: Record<string, unknown> = {}) => ({
    slides: list, themeId: "dali-dark", currentId: list[0].id, peers: new Map(), editable: true,
    onSelect: () => {}, onAdd: () => {}, onDuplicate: () => {}, onDelete: () => {}, onMove: () => {}, ...over,
  });

  it("dims a skipped slide and says so", () => {
    const { list } = slides();
    const el = render(createElement(Filmstrip, props([list[0], { ...list[1], skipped: true }, list[2]]) as never));
    expect(el.querySelectorAll("[data-testid=slide-skipped]")).toHaveLength(1);
    expect(el.querySelector("button[aria-label='Slide 2']")!.className).toContain("opacity-50");
    expect(el.querySelector("button[aria-label='Slide 1']")!.className).not.toContain("opacity-50");
  });

  it("passes shift and meta to the selection handler and marks selected thumbnails", () => {
    const { list } = slides();
    const onSelect = vi.fn();
    const el = render(createElement(Filmstrip, props(list, { onSelect, selectedIds: [list[0].id, list[2].id] }) as never));
    act(() => void el.querySelector("button[aria-label='Slide 3']")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
    expect(onSelect).toHaveBeenLastCalledWith(list[2].id, { shift: true, meta: false });
    act(() => void el.querySelector("button[aria-label='Slide 2']")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    expect(onSelect).toHaveBeenLastCalledWith(list[1].id, { shift: false, meta: true });
    expect(el.querySelector("button[aria-label='Slide 3']")!.getAttribute("aria-selected")).toBe("true");
    expect(el.querySelector("button[aria-label='Slide 2']")!.getAttribute("aria-selected")).toBeNull();
  });

  it("selects the thumbnail it is right-clicked on unless it is already selected, then opens its actions", () => {
    const { list } = slides();
    const onSelect = vi.fn();
    const actionsFor = vi.fn(() => [{ id: "x", label: "Do it", run: () => {} }]);
    const el = render(createElement(Filmstrip, props(list, { onSelect, actionsFor, selectedIds: [list[0].id] }) as never));
    rightClick(el.querySelector("button[aria-label='Slide 2']")!);
    expect(onSelect).toHaveBeenLastCalledWith(list[1].id, { shift: false, meta: false });
    expect(row("Do it")).toBeDefined();
    onSelect.mockClear();
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    rightClick(el.querySelector("button[aria-label='Slide 1']")!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(actionsFor).toHaveBeenCalledWith(list[0].id);
  });
});
