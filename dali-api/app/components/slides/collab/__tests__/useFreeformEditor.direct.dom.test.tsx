// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { addFreeImage, addShape, addTextBox, setLocked } from "~/components/slides/deck/freeform-ops";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { setStyleClip } from "~/components/slides/deck/style-clip";
import type { DeckDoc } from "../useDeckDoc";
import { useFreeformEditor, type FreeformEditor, type FreeformExternal } from "../useFreeformEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let editor: FreeformEditor;
let ext: FreeformExternal;

function Harness(p: { deck: DeckDoc; slide: ReturnType<typeof snapshotDeck>["slides"][number] | null }) {
  editor = useFreeformEditor({ deck: p.deck, slide: p.slide, editable: true, external: ext });
  return null;
}

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  const awareness = { clientID: 1, getStates: () => new Map(), on: vi.fn(), off: vi.fn(), setLocalStateField: vi.fn() };
  const deck = { doc, undo, entry: { provider: { awareness } }, store: {} } as unknown as DeckDoc;
  const render = () => act(() => root.render(createElement(Harness, { deck, slide: snapshotDeck(doc).slides[0] })));
  render();
  return { doc, slideId, undo, deck, render };
}
const els = (doc: Y.Doc) => snapshotDeck(doc).slides[0].elements;
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));

let clipboard: string;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  ext = { pickReplace: vi.fn(), pickAt: vi.fn(), insertAt: vi.fn(), addImages: vi.fn(), comment: vi.fn(), changeLayout: vi.fn() };
  clipboard = "";
  vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => void (clipboard = t), readText: async () => clipboard } });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => (fn(), 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  setStyleClip(null);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("selection and editing transitions", () => {
  it("keeps the selection a right click lands in and replaces one it misses", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect")!;
    const b = addShape(doc, slideId, "ellipse")!;
    const c = addShape(doc, slideId, "line")!;
    render();
    act(() => editor.setSelection([a, b]));
    let out: string[] = [];
    act(() => void (out = editor.stage.onContext(b)));
    expect(out).toEqual([a, b]);
    expect(editor.selection).toEqual([a, b]);
    act(() => void (out = editor.stage.onContext(c)));
    expect(out).toEqual([c]);
    expect(editor.selection).toEqual([c]);
    act(() => void (out = editor.stage.onContext(null)));
    expect(editor.selection).toEqual([]);
  });

  it("double click edits text and crops an image, and does nothing special for a shape or a locked text box", () => {
    const { doc, slideId, render } = setup();
    const t = addTextBox(doc, slideId)!;
    const i = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const s = addShape(doc, slideId, "rect")!;
    const locked = addTextBox(doc, slideId)!;
    setLocked(doc, slideId, [locked], true);
    render();
    act(() => editor.stage.onActivate(t, { x: 10, y: 20 }));
    expect(editor.stage.editingId).toBe(t);
    expect(editor.stage.editPoint.current).toEqual({ x: 10, y: 20 });
    act(() => editor.stage.onActivate(i, { x: 0, y: 0 }));
    expect(editor.stage.cropId).toBe(i);
    expect(editor.stage.editingId).toBeNull();
    act(() => editor.stage.onActivate(s, { x: 0, y: 0 }));
    expect([editor.stage.editingId, editor.stage.cropId, editor.selection]).toEqual([null, null, [s]]);
    act(() => editor.stage.onActivate(locked, { x: 0, y: 0 }));
    expect(editor.stage.editingId).toBeNull();
  });

  it("Enter edits the selected text box; Escape steps out, then deselects", () => {
    const { doc, slideId, render } = setup();
    const t = addTextBox(doc, slideId)!;
    render();
    act(() => editor.setSelection([t]));
    key("Enter");
    expect(editor.stage.editingId).toBe(t);
    act(() => editor.stage.onEscape());
    expect(editor.stage.editingId).toBeNull();
    expect(editor.selection).toEqual([t]);
    key("Escape");
    expect(editor.selection).toEqual([]);
  });

  it("Enter crops a selected image, and Escape leaves crop before it deselects", () => {
    const { doc, slideId, render } = setup();
    const i = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    render();
    act(() => editor.setSelection([i]));
    key("Enter");
    expect(editor.stage.cropId).toBe(i);
    key("Escape");
    expect(editor.stage.cropId).toBeNull();
    expect(editor.selection).toEqual([i]);
  });

  it("drops out of crop when the selection moves elsewhere", () => {
    const { doc, slideId, render } = setup();
    const i = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    const s = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([i]));
    act(() => editor.stage.handlers.crop(i));
    expect(editor.stage.cropId).toBe(i);
    act(() => editor.setSelection([s]));
    expect(editor.stage.cropId).toBeNull();
  });

  it("ignores Enter with several selected", () => {
    const { doc, slideId, render } = setup();
    const a = addTextBox(doc, slideId)!;
    const b = addTextBox(doc, slideId)!;
    render();
    act(() => editor.setSelection([a, b]));
    key("Enter");
    expect(editor.stage.editingId).toBeNull();
  });
});

describe("alt drag duplicate", () => {
  it("leaves the originals, puts copies at the drop place, selects the copies, and undoes in one step", () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 300 })!;
    render();
    const orig = els(doc).find((e) => e.id === a)!;
    undo.manager.clear();
    act(() => editor.stage.onCommit({ [a]: { x: orig.x! + 200, y: orig.y!, w: orig.w!, h: orig.h!, rot: 0 } }, { duplicate: true }));
    const after = els(doc);
    expect(after).toHaveLength(2);
    expect(after.find((e) => e.id === a)).toMatchObject({ x: orig.x, y: orig.y });
    const copy = after.find((e) => e.id !== a)!;
    expect(copy).toMatchObject({ x: orig.x! + 200, y: orig.y, shape: "rect" });
    render();
    expect(editor.selection).toEqual([copy.id]);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(els(doc).find((e) => e.id === copy.id)).toMatchObject({ x: orig.x, y: orig.y });
  });

  it("a plain drag moves the element in one undo step", () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 300 })!;
    render();
    const o = els(doc)[0];
    undo.manager.clear();
    act(() => editor.stage.onCommit({ [a]: { x: o.x! + 50, y: o.y!, w: o.w!, h: o.h!, rot: 0 } }));
    expect(els(doc)).toHaveLength(1);
    expect(els(doc)[0].x).toBe(o.x! + 50);
    expect(undo.manager.undoStack).toHaveLength(1);
  });
});

describe("lock", () => {
  it("locks and unlocks the selection in one step each", () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([a]));
    undo.manager.clear();
    act(() => editor.stage.handlers.lock(true));
    expect(els(doc)[0].locked).toBe(true);
    expect(undo.manager.undoStack).toHaveLength(1);
    act(() => editor.stage.handlers.lock(false));
    expect(els(doc)[0].locked).toBeUndefined();
  });

  it("Delete, nudge and cut do nothing to a locked element", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 300 })!;
    setLocked(doc, slideId, [a], true);
    render();
    const before = els(doc)[0];
    act(() => editor.setSelection([a]));
    key("Delete");
    key("ArrowRight");
    act(() => editor.stage.handlers.cut());
    expect(els(doc)).toHaveLength(1);
    expect(els(doc)[0].x).toBe(before.x);
  });
});

describe("copy and paste", () => {
  it("copies to the clipboard, pastes at a point and offsets nothing there", async () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 300, y: 300 })!;
    render();
    act(() => editor.setSelection([a]));
    await act(async () => editor.stage.handlers.copy());
    expect(clipboard).toContain("dali-slides-elements");
    undo.manager.clear();
    await act(async () => editor.stage.stageHandlers({ x: 1200, y: 700 }).paste());
    const pasted = els(doc).find((e) => e.id !== a)!;
    expect(pasted.x! + pasted.w! / 2).toBeCloseTo(1200);
    expect(pasted.y! + pasted.h! / 2).toBeCloseTo(700);
    render();
    expect(editor.selection).toEqual([pasted.id]);
  });

  it("cut copies then removes in one undo step", async () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([a]));
    undo.manager.clear();
    await act(async () => editor.stage.handlers.cut());
    expect(clipboard).toContain("dali-slides-elements");
    expect(els(doc)).toHaveLength(0);
    expect(undo.manager.undoStack).toHaveLength(1);
    undo.manager.undo();
    expect(els(doc)).toHaveLength(1);
  });

  it("ignores clipboard text that is not slide elements", async () => {
    const { doc, render } = setup();
    clipboard = "hello";
    render();
    await act(async () => editor.stage.handlers.paste());
    expect(els(doc)).toHaveLength(0);
  });

  it("pastes an image file from the clipboard through the host, and not text", () => {
    setup();
    const file = new File(["x"], "a.png", { type: "image/png" });
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { files: [file], getData: () => "" };
    act(() => void document.body.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    expect(ext.addImages).toHaveBeenCalledWith([file], null);
  });

  it("leaves paste alone inside an input", () => {
    setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { files: [new File(["x"], "a.png", { type: "image/png" })], getData: () => "" };
    act(() => void input.dispatchEvent(e));
    expect(ext.addImages).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("copy and paste style", () => {
  it("copies a shape's style and pastes it to another shape in one undo step", () => {
    const { doc, slideId, undo, render } = setup();
    const a = addShape(doc, slideId, "rect", undefined, "muted")!;
    const b = addShape(doc, slideId, "rect", undefined, "accent")!;
    render();
    act(() => editor.setSelection([a]));
    act(() => editor.stage.handlers.copyStyle());
    render();
    expect(editor.stage.styleKind).toBe("shape");
    act(() => editor.setSelection([b]));
    undo.manager.clear();
    act(() => editor.stage.handlers.pasteStyle());
    expect(els(doc).find((e) => e.id === b)!.fill).toBe("muted");
    expect(undo.manager.undoStack).toHaveLength(1);
  });

  it("runs from Option-Command-C and V", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect", undefined, "rule")!;
    const b = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([a]));
    key("c", { metaKey: true, altKey: true, code: "KeyC" });
    act(() => editor.setSelection([b]));
    key("v", { metaKey: true, altKey: true, code: "KeyV" });
    expect(els(doc).find((e) => e.id === b)!.fill).toBe("rule");
  });

  it("copies nothing from an image or several elements", () => {
    const { doc, slideId, render } = setup();
    const i = addFreeImage(doc, slideId, "https://x/y.png", "y")!;
    render();
    act(() => editor.setSelection([i]));
    act(() => editor.stage.handlers.copyStyle());
    render();
    expect(editor.stage.styleKind).toBeNull();
  });
});

describe("menu handlers", () => {
  it("adds and removes a build, comments, replaces and snaps back through the host", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([a]));
    act(() => editor.stage.handlers.toggleBuild(a));
    expect(els(doc)[0].build).toBe(1);
    render();
    act(() => editor.stage.handlers.toggleBuild(a));
    expect(els(doc)[0].build).toBeUndefined();
    act(() => editor.stage.handlers.comment(a));
    expect(ext.comment).toHaveBeenCalledWith({ slideId, elementId: a });
    act(() => editor.stage.handlers.replaceImage(a));
    expect(ext.pickReplace).toHaveBeenCalledWith(a);
  });

  it("stage handlers add a text box and shape at the point, ask for an image there, and comment with fractions", () => {
    const { doc, slideId } = setup();
    act(() => editor.insert.shape("ellipse", { x: 960, y: 540 }));
    expect(els(doc).find((e) => e.shape === "ellipse")).toBeDefined();
    act(() => editor.insert.text({ x: 960, y: 540 }));
    expect(editor.stage.editingId).toBe(els(doc).find((e) => e.kind === "text")!.id);
    act(() => editor.stage.stageHandlers({ x: 100, y: 200 }).insert({ type: "image" }));
    expect(ext.insertAt).toHaveBeenCalledWith({ type: "image" }, { x: 100, y: 200 });
    act(() => editor.stage.stageHandlers({ x: 480, y: 270 }).comment());
    expect(ext.comment).toHaveBeenCalledWith({ slideId, x: 0.25, y: 0.25 });
    act(() => editor.stage.stageHandlers({ x: 0, y: 0 }).changeLayout("title"));
    expect(ext.changeLayout).toHaveBeenCalledWith("title");
  });

  it("selects every element, and toggles guides and grid through the snap preferences", () => {
    const { doc, slideId, render } = setup();
    addShape(doc, slideId, "rect");
    addShape(doc, slideId, "ellipse");
    render();
    act(() => editor.stage.stageHandlers({ x: 0, y: 0 }).selectAll());
    expect(editor.selection).toHaveLength(2);
    act(() => editor.stage.stageHandlers({ x: 0, y: 0 }).setGuides(false));
    expect(editor.stage.prefs).toMatchObject({ items: false, margins: false });
    act(() => editor.stage.stageHandlers({ x: 0, y: 0 }).setGrid(true));
    expect(editor.stage.prefs.grid).toBe(true);
  });

  it("grows a text box from the stage and not a fixed one", () => {
    const { doc, slideId, render } = setup();
    const t = addTextBox(doc, slideId)!;
    render();
    act(() => editor.stage.onGrow(t, 400));
    expect(els(doc)[0].h).toBe(400);
  });

  it("applies bar text style, fill and unlock as undoable steps", () => {
    const { doc, slideId, undo, render } = setup();
    const t = addTextBox(doc, slideId)!;
    const s = addShape(doc, slideId, "rect")!;
    render();
    undo.manager.clear();
    act(() => editor.stage.barHandlers.textStyle(t, "title"));
    expect(els(doc).find((e) => e.id === t)!.textStyle).toBe("title");
    expect(undo.manager.undoStack).toHaveLength(1);
    act(() => editor.setSelection([s]));
    act(() => editor.stage.barHandlers.fill("muted"));
    expect(els(doc).find((e) => e.id === s)!.fill).toBe("muted");
  });

  it("Command-A and Escape work from the keyboard", () => {
    const { doc, slideId, render } = setup();
    addShape(doc, slideId, "rect");
    render();
    key("a", { metaKey: true });
    expect(editor.selection).toHaveLength(1);
    key("Escape");
    expect(editor.selection).toEqual([]);
  });
});
