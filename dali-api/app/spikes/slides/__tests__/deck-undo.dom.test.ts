// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { ySyncPluginKey, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  addSlide,
  addTextElement,
  initDeck,
  moveElement,
  slidesMap,
  textFragment,
} from "../deck-model";
import { createDeckUndoManager, deckUndoExtension, listenerCount } from "../deck-undo";

function mountEditor(ydoc: Y.Doc, slideId: string, elId: string, extension: unknown) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: { fragment: textFragment(ydoc, slideId, elId), user: { name: "Ada", color: "#336699" } },
      extensions: [extension],
      disableExtensions: ["yUndo"],
    } as never) as never,
  );
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return { editor, el };
}

function deck() {
  const ydoc = new Y.Doc();
  initDeck(ydoc);
  for (const n of [1, 2, 3]) {
    addSlide(ydoc, `s${n}`, n);
    addTextElement(ydoc, `s${n}`, `t${n}`);
  }
  return ydoc;
}

const text = (e: BlockNoteEditor) => e.prosemirrorState.doc.textContent;
const x = (ydoc: Y.Doc, s: string, el: string) =>
  ((slidesMap(ydoc).get(s)!.get("elements") as Y.Map<Y.Map<unknown>>).get(el)!.get("x"));
const type = (e: BlockNoteEditor, s: string) => e.insertInlineContent(s);

function setup() {
  const ydoc = deck();
  const deckUndo = createDeckUndoManager(slidesMap(ydoc), [LOCAL_ORIGIN]);
  const ext = deckUndoExtension(deckUndo);
  const a = mountEditor(ydoc, "s1", "t1", ext);
  const b = mountEditor(ydoc, "s2", "t2", ext);
  const c = mountEditor(ydoc, "s3", "t3", ext);
  return { ydoc, deckUndo, ext, a, b, c };
}

describe("deck-level undo over many BlockNote editors", () => {
  it("one stack: type in A, move element, type in B undoes in reverse and redoes", () => {
    const { ydoc, deckUndo, a, b } = setup();
    type(a.editor, "alpha");
    deckUndo.stopCapturing();
    moveElement(ydoc, "s1", "t1", 555, 100);
    deckUndo.stopCapturing();
    type(b.editor, "beta");
    deckUndo.stopCapturing();

    expect(deckUndo.undoStack.length).toBe(3);
    expect([text(a.editor), x(ydoc, "s1", "t1"), text(b.editor)]).toEqual(["alpha", 555, "beta"]);

    deckUndo.undo();
    expect([text(a.editor), x(ydoc, "s1", "t1"), text(b.editor)]).toEqual(["alpha", 555, ""]);
    deckUndo.undo();
    expect([text(a.editor), x(ydoc, "s1", "t1"), text(b.editor)]).toEqual(["alpha", 100, ""]);
    deckUndo.undo();
    expect([text(a.editor), x(ydoc, "s1", "t1"), text(b.editor)]).toEqual(["", 100, ""]);
    expect(deckUndo.canUndo()).toBe(false);

    deckUndo.redo();
    deckUndo.redo();
    deckUndo.redo();
    expect([text(a.editor), x(ydoc, "s1", "t1"), text(b.editor)]).toEqual(["alpha", 555, "beta"]);
  });

  it("Mod-z / Mod-Shift-z key handling reaches the shared manager before BlockNote's own Mod-z", () => {
    const { deckUndo, a, b } = setup();
    type(a.editor, "alpha");
    deckUndo.stopCapturing();
    type(b.editor, "beta");
    const view = b.editor.prosemirrorView!;
    const press = (init: KeyboardEventInit) =>
      view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", init)));
    expect(press({ key: "z", ctrlKey: true })).toBe(true);
    expect(text(b.editor)).toBe("");
    expect(text(a.editor)).toBe("alpha");
    expect(press({ key: "z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(text(b.editor)).toBe("beta");
  });

  it("editor.undo() throws when yUndo is disabled (toolbar/menu must call deckUndo directly)", () => {
    const { a } = setup();
    expect(() => a.editor.undo()).toThrow(/No undo plugin/);
  });

  it("remote changes from a synced second Y.Doc are not undone", () => {
    const { ydoc, deckUndo, a, b } = setup();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    remote.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "from-local") Y.applyUpdate(ydoc, u, "remote");
    });
    ydoc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(remote, u, "from-local");
    });

    type(a.editor, "mine");
    deckUndo.stopCapturing();
    const remoteEditor = mountEditor(remote, "s2", "t2", { key: "noop", prosemirrorPlugins: [] });
    type(remoteEditor.editor, "theirs");
    moveElement(remote, "s3", "t3", 777, 5, "remote-user");
    expect(text(b.editor)).toBe("theirs");
    expect(x(ydoc, "s3", "t3")).toBe(777);

    expect(deckUndo.undoStack.length).toBe(1);
    deckUndo.undo();
    expect(text(a.editor)).toBe("");
    expect(text(b.editor)).toBe("theirs");
    expect(x(ydoc, "s3", "t3")).toBe(777);
    expect(deckUndo.canUndo()).toBe(false);
  });

  it("tracked origin is the editor's own sync plugin key, shared with our y-prosemirror import", () => {
    const { deckUndo, a } = setup();
    const syncPlugin = a.editor.prosemirrorState.plugins.find((p) => p.key.startsWith("y-sync"))!;
    const origin = (syncPlugin.spec as { key: unknown }).key;
    expect(deckUndo.trackedOrigins.has(origin)).toBe(true);
    expect(origin).toBe(ySyncPluginKey);
  });

  it("unmount/remount cycles do not leak listeners and do not destroy the shared manager", () => {
    const { ydoc, deckUndo, ext, a } = setup();
    const baseline = listenerCount(deckUndo);
    expect(baseline).toBe(2 * 3);
    a.editor.unmount();
    expect(listenerCount(deckUndo)).toBe(baseline - 2);
    for (let i = 0; i < 20; i++) {
      const el = document.createElement("div");
      document.body.appendChild(el);
      a.editor.mount(el);
      a.editor.unmount();
    }
    expect(listenerCount(deckUndo)).toBe(baseline - 2);
    const el = document.createElement("div");
    document.body.appendChild(el);
    a.editor.mount(el);
    expect(listenerCount(deckUndo)).toBe(baseline);

    type(a.editor, "after");
    deckUndo.stopCapturing();
    expect(deckUndo.undoStack.length).toBe(1);
    deckUndo.undo();
    expect(text(a.editor)).toBe("");

    const fresh = mountEditor(ydoc, "s1", "t1", ext);
    fresh.editor.unmount();
    expect(listenerCount(deckUndo)).toBe(baseline);
  });

  it("stock yUndoPlugin with a shared manager destroys it on the first unmount (why the custom plugin exists)", () => {
    const ydoc = deck();
    const deckUndo = createDeckUndoManager(slidesMap(ydoc), [LOCAL_ORIGIN, ySyncPluginKey]);
    const ext = { key: "stock", prosemirrorPlugins: [yUndoPlugin({ undoManager: deckUndo })] };
    const a = mountEditor(ydoc, "s1", "t1", ext);
    const b = mountEditor(ydoc, "s2", "t2", ext);
    type(a.editor, "x");
    deckUndo.stopCapturing();
    expect(deckUndo.undoStack.length).toBe(1);
    a.editor.unmount();
    type(b.editor, "y");
    deckUndo.stopCapturing();
    expect(deckUndo.undoStack.length).toBe(1);
  });
});
