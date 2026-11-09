// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { CLIP_MARK, CLIP_VERSION } from "~/components/slides/deck/clipboard";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { createDeckUndo } from "~/components/slides/deck/deck-undo";
import { addShape } from "~/components/slides/deck/freeform-ops";
import { deckMap, initDeck, slidesMap } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { readPeerDrags, type DeckDoc } from "../useDeckDoc";
import { useFreeformEditor, type FreeformEditor } from "../useFreeformEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeAwareness {
  clientID = 1;
  states = new Map<number, Record<string, unknown>>();
  local: Record<string, unknown> = {};
  listeners = new Set<() => void>();
  getStates() {
    return this.states;
  }
  on(_e: string, fn: () => void) {
    this.listeners.add(fn);
  }
  off(_e: string, fn: () => void) {
    this.listeners.delete(fn);
  }
  setLocalStateField = vi.fn((k: string, v: unknown) => {
    this.local[k] = v;
  });
}

let container: HTMLDivElement;
let root: Root;
let editor: FreeformEditor;
let awareness: FakeAwareness;

function Harness(p: { deck: DeckDoc; slide: ReturnType<typeof snapshotDeck>["slides"][number] | null; editable?: boolean }) {
  editor = useFreeformEditor({ deck: p.deck, slide: p.slide, editable: p.editable ?? true });
  return null;
}

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
  undo.manager.clear();
  awareness = new FakeAwareness();
  const deck = { doc, undo, entry: { provider: { awareness } }, store: {} } as unknown as DeckDoc;
  const render = () => act(() => root.render(createElement(Harness, { deck, slide: snapshotDeck(doc).slides[0] })));
  render();
  return { doc, slideId, undo, deck, render };
}

const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const elements = (doc: Y.Doc) => snapshotDeck(doc).slides[0].elements;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => (fn(), 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useFreeformEditor", () => {
  it("places the armed tool, selects the new item and disarms", () => {
    const { doc, undo, render } = setup();
    act(() => editor.arm({ type: "shape", shape: "ellipse" }));
    act(() => editor.stage.onPlace({ type: "shape", shape: "ellipse" }, { x: 400, y: 300 }));
    render();
    const added = elements(doc).find((e) => e.shape === "ellipse")!;
    expect(added).toMatchObject({ x: 200, y: 100 });
    expect(editor.selection).toEqual([added.id]);
    expect(editor.armed).toBeNull();
    undo.manager.undo();
    expect(elements(doc).some((e) => e.shape === "ellipse")).toBe(false);
  });

  it("starts editing a new text box", () => {
    const { doc } = setup();
    act(() => editor.stage.onPlace({ type: "text" }, { x: 960, y: 540 }));
    const added = elements(doc).find((e) => e.kind === "text")!;
    expect(editor.stage.editingId).toBe(added.id);
  });

  it("commits a drag as one undo step", () => {
    const { doc, slideId, undo, render } = setup();
    const id = addShape(doc, slideId, "rect", { x: 500, y: 500 })!;
    undo.manager.clear();
    render();
    const start = elements(doc).find((e) => e.id === id)!;
    act(() => editor.stage.onCommit({ [id]: { x: start.x! + 100, y: start.y!, w: start.w!, h: start.h!, rot: 0 } }));
    act(() => editor.stage.onCommit({ [id]: { x: start.x! + 200, y: start.y!, w: start.w!, h: start.h!, rot: 0 } }));
    undo.manager.undo();
    expect(elements(doc).find((e) => e.id === id)!.x).toBe(start.x! + 100);
    undo.manager.undo();
    expect(elements(doc).find((e) => e.id === id)!.x).toBe(start.x);
  });

  it("shares a drag through awareness and leaves the doc alone until the commit", () => {
    const { doc, slideId, render } = setup();
    const id = addShape(doc, slideId, "rect", { x: 500, y: 500 })!;
    render();
    const before = Y.encodeStateVector(doc);
    act(() => editor.stage.onPublishDrag(new Map([[id, { x: 1, y: 2, w: 30, h: 40, rot: 5 }]])));
    expect(awareness.local.dragging).toEqual({ slideId, rects: { [id]: { x: 1, y: 2, w: 30, h: 40, rot: 5 } } });
    expect(Y.encodeStateVector(doc)).toEqual(before);
    act(() => editor.stage.onPublishDrag(null));
    expect(awareness.local.dragging).toBeNull();
  });

  it("shows a peer's drag from awareness", () => {
    const { slideId } = setup();
    awareness.states.set(2, { dragging: { slideId, rects: { a: { x: 5, y: 6, w: 70, h: 80, rot: 0 } } } });
    act(() => awareness.listeners.forEach((l) => l()));
    expect(editor.stage.peerDrags.get("a")).toEqual({ x: 5, y: 6, w: 70, h: 80, rot: 0 });
  });

  it("deletes, nudges, duplicates and groups from the keyboard", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 500 })!;
    const b = addShape(doc, slideId, "rect", { x: 900, y: 500 })!;
    render();
    act(() => editor.setSelection([a]));
    const ax = elements(doc).find((e) => e.id === a)!.x!;
    key("ArrowRight");
    key("ArrowRight", { shiftKey: true });
    expect(elements(doc).find((e) => e.id === a)!.x).toBe(ax + 11);
    act(() => editor.setSelection([a, b]));
    key("g", { metaKey: true });
    render();
    const group = elements(doc).find((e) => e.kind === "group")!;
    expect(editor.selection).toEqual([group.id]);
    key("g", { metaKey: true, shiftKey: true });
    render();
    expect(elements(doc).some((e) => e.kind === "group")).toBe(false);
    act(() => editor.setSelection([a]));
    key("d", { metaKey: true });
    render();
    expect(elements(doc).filter((e) => e.kind === "shape")).toHaveLength(3);
    key("Delete");
    expect(elements(doc).filter((e) => e.kind === "shape")).toHaveLength(2);
  });

  it("ignores shortcuts while typing in a text field", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 500 })!;
    render();
    act(() => editor.setSelection([a]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("Delete", {}, input);
    expect(elements(doc).some((e) => e.id === a)).toBe(true);
    input.remove();
  });

  it("clears the selection and the armed tool on escape, and selects all on cmd A", () => {
    const { doc, slideId, render } = setup();
    addShape(doc, slideId, "rect");
    addShape(doc, slideId, "ellipse");
    render();
    key("a", { metaKey: true });
    expect(editor.selection).toHaveLength(2);
    act(() => editor.arm({ type: "text" }));
    key("Escape");
    expect(editor.selection).toEqual([]);
    expect(editor.armed).toBeNull();
  });

  it("copies the selection as clipboard text and pastes it back as new elements", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect", { x: 500, y: 500 })!;
    render();
    act(() => editor.setSelection([a]));
    const data = new Map<string, string>();
    const copy = new Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    copy.clipboardData = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? "" };
    act(() => void window.dispatchEvent(copy));
    expect(JSON.parse(data.get("text/plain")!)).toMatchObject({ mark: CLIP_MARK, v: CLIP_VERSION });
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = copy.clipboardData;
    act(() => void window.dispatchEvent(paste));
    render();
    expect(elements(doc).filter((e) => e.kind === "shape")).toHaveLength(2);
    expect(editor.selection).toHaveLength(1);
    expect(editor.selection[0]).not.toBe(a);
  });

  it("does not paste text that is not ours", () => {
    const { doc, slideId, render } = setup();
    addShape(doc, slideId, "rect");
    render();
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => "just words" };
    act(() => void window.dispatchEvent(paste));
    expect(elements(doc).filter((e) => e.kind === "shape")).toHaveLength(1);
  });

  it("drops selected ids that a peer deleted", () => {
    const { doc, slideId, render } = setup();
    const a = addShape(doc, slideId, "rect")!;
    render();
    act(() => editor.setSelection([a]));
    act(() => slidesMap(doc).get(slideId)!.get("elements") instanceof Y.Map && (slidesMap(doc).get(slideId)!.get("elements") as Y.Map<Y.Map<unknown>>).get(a)!.set("deleted", true));
    render();
    expect(editor.selection).toEqual([]);
  });

  it("does nothing from the keyboard for a reader", () => {
    const { doc, slideId } = setup();
    const a = addShape(doc, slideId, "rect")!;
    act(() => root.render(createElement(Harness, { deck: { doc, undo: createDeckUndo([slidesMap(doc)]), entry: { provider: { awareness } } } as unknown as DeckDoc, slide: snapshotDeck(doc).slides[0], editable: false })));
    act(() => editor.setSelection([a]));
    key("Delete");
    expect(elements(doc).some((e) => e.id === a)).toBe(true);
  });
});

describe("readPeerDrags", () => {
  it("reads only other clients' drags on this slide and drops malformed rects", () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    const out = readPeerDrags(
      [
        [1, { dragging: { slideId: "s", rects: { me: rect } } }],
        [2, { dragging: { slideId: "other", rects: { elsewhere: rect } } }],
        [3, { dragging: { slideId: "s", rects: { ok: { ...rect, rot: 9 }, bad: { x: "1", y: 2, w: 3, h: 4 }, zero: { ...rect, w: 0 } } } }],
        [4, { dragging: null }],
        [5, {}],
        [6, { dragging: { slideId: "s", rects: "nope" } }],
      ],
      1,
      "s",
    );
    expect([...out.keys()]).toEqual(["ok"]);
    expect(out.get("ok")).toEqual({ x: 1, y: 2, w: 3, h: 4, rot: 9 });
  });
});
