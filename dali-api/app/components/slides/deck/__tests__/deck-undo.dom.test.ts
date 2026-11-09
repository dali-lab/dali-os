// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { ySyncPluginKey, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import { readDeck } from "~/collab/read-deck.server";
import { blocksToFragment } from "~/collab/blocknote-server";
import { DECK_LOCAL, addSlide, duplicateSlide, deleteSlide, moveSlide, setLayout, slideFragment, undeleteSlide, visibleSlideIds } from "../deck-ops";
import { createDeckUndo, deckUndoExtension, listenerCount } from "../deck-undo";
import { deckMap, initDeck, slidesMap } from "../model";

function mountEditor(ydoc: Y.Doc, slideId: string, extension: unknown) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: { fragment: slideFragment(ydoc, slideId, "title")!, user: { name: "Ada", color: "#336699" } },
      extensions: [extension],
      disableExtensions: ["yUndo"],
    } as never) as never,
  ) as unknown as BlockNoteEditor;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return { editor, el };
}

function setup() {
  const ydoc = new Y.Doc();
  initDeck(ydoc);
  const ids: string[] = [];
  let after: string | null = null;
  for (let i = 0; i < 3; i++) {
    after = addSlide(ydoc, "content", after);
    ids.push(after);
  }
  const undo = createDeckUndo([slidesMap(ydoc), deckMap(ydoc)]);
  undo.manager.clear();
  const ext = deckUndoExtension(undo.manager);
  const [a, b, c] = ids.map((id) => mountEditor(ydoc, id, ext));
  return { ydoc, undo, ext, ids, a, b, c, manager: undo.manager };
}

const text = (e: BlockNoteEditor) => e.prosemirrorState.doc.textContent;
const layoutOf = (ydoc: Y.Doc, id: string) => slidesMap(ydoc).get(id)!.get("layoutId");
const type = (e: BlockNoteEditor, s: string) => e.insertInlineContent(s);

describe("deck-level undo over many BlockNote editors", () => {
  it("one stack across text and map writes: undoes in reverse and redoes", () => {
    const { ydoc, manager, ids, a, b } = setup();
    type(a.editor, "alpha");
    manager.stopCapturing();
    setLayout(ydoc, ids[0], "split");
    manager.stopCapturing();
    type(b.editor, "beta");
    manager.stopCapturing();
    expect(manager.undoStack.length).toBe(3);

    manager.undo();
    expect([text(a.editor), layoutOf(ydoc, ids[0]), text(b.editor)]).toEqual(["alpha", "split", ""]);
    manager.undo();
    expect([text(a.editor), layoutOf(ydoc, ids[0]), text(b.editor)]).toEqual(["alpha", "content", ""]);
    manager.undo();
    expect([text(a.editor), layoutOf(ydoc, ids[0])]).toEqual(["", "content"]);
    expect(manager.canUndo()).toBe(false);
    manager.redo();
    manager.redo();
    manager.redo();
    expect([text(a.editor), layoutOf(ydoc, ids[0]), text(b.editor)]).toEqual(["alpha", "split", "beta"]);
  });

  it("Mod-z and Mod-Shift-z reach the shared manager", () => {
    const { manager, a, b } = setup();
    type(a.editor, "alpha");
    manager.stopCapturing();
    type(b.editor, "beta");
    const view = b.editor.prosemirrorView!;
    const press = (init: KeyboardEventInit) => view.someProp("handleKeyDown", (f: (v: typeof view, e: KeyboardEvent) => boolean | void) => f(view, new KeyboardEvent("keydown", init)));
    expect(press({ key: "z", ctrlKey: true })).toBe(true);
    expect(text(b.editor)).toBe("");
    expect(text(a.editor)).toBe("alpha");
    expect(press({ key: "z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(text(b.editor)).toBe("beta");
  });

  it("a peer's changes are not undone", () => {
    const { ydoc, manager, ids, a, b } = setup();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(ydoc));
    remote.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "from-local") Y.applyUpdate(ydoc, u, "remote");
    });
    ydoc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(remote, u, "from-local");
    });
    type(a.editor, "mine");
    manager.stopCapturing();
    const peer = mountEditor(remote, ids[1], { key: "noop", prosemirrorPlugins: [] });
    type(peer.editor, "theirs");
    setLayout(remote, ids[2], "image");
    expect(text(b.editor)).toBe("theirs");
    expect(layoutOf(ydoc, ids[2])).toBe("image");
    expect(manager.undoStack.length).toBe(1);
    manager.undo();
    expect(text(a.editor)).toBe("");
    expect(text(b.editor)).toBe("theirs");
    expect(layoutOf(ydoc, ids[2])).toBe("image");
  });

  it("remounting editors leaves no listeners behind and keeps the manager alive", () => {
    const { ydoc, manager, ids, ext, a } = setup();
    const baseline = listenerCount(manager);
    a.editor.unmount();
    expect(listenerCount(manager)).toBe(baseline - 2);
    for (let i = 0; i < 20; i++) {
      const el = document.createElement("div");
      document.body.appendChild(el);
      a.editor.mount(el);
      a.editor.unmount();
    }
    expect(listenerCount(manager)).toBe(baseline - 2);
    const el = document.createElement("div");
    document.body.appendChild(el);
    a.editor.mount(el);
    expect(listenerCount(manager)).toBe(baseline);
    type(a.editor, "after");
    manager.stopCapturing();
    manager.undo();
    expect(text(a.editor)).toBe("");
    mountEditor(ydoc, ids[0], ext).editor.unmount();
    expect(listenerCount(manager)).toBe(baseline);
  });

  it("the stock yUndoPlugin would destroy the shared manager on the first unmount", () => {
    const ydoc = new Y.Doc();
    initDeck(ydoc);
    const s1 = addSlide(ydoc, "content", null);
    const s2 = addSlide(ydoc, "content", s1);
    const undo = createDeckUndo([slidesMap(ydoc)], [DECK_LOCAL, ySyncPluginKey]);
    const ext = { key: "stock", prosemirrorPlugins: [yUndoPlugin({ undoManager: undo.manager })] };
    const a = mountEditor(ydoc, s1, ext);
    const b = mountEditor(ydoc, s2, ext);
    a.editor.unmount();
    type(b.editor, "y");
    undo.manager.stopCapturing();
    expect(undo.manager.undoStack.length).toBe(0);
  });
});

describe("history remembers the slide", () => {
  it("navigates to the slide a change was made on, for undo and redo", () => {
    const { ydoc, undo, ids, manager } = setup();
    const visited: string[] = [];
    undo.setNavigator((id) => visited.push(id));
    undo.setCurrentSlide(ids[0]);
    setLayout(ydoc, ids[0], "split");
    manager.stopCapturing();
    undo.setCurrentSlide(ids[2]);
    setLayout(ydoc, ids[2], "image");
    manager.stopCapturing();
    undo.setCurrentSlide(ids[1]);

    manager.undo();
    manager.undo();
    expect(visited).toEqual([ids[2], ids[0]]);
    manager.redo();
    manager.redo();
    expect(visited).toEqual([ids[2], ids[0], ids[0], ids[2]]);
  });

  it("history items from before the user was on any slide do not navigate", () => {
    const { ydoc, undo, ids, manager } = setup();
    const visited: string[] = [];
    undo.setNavigator((id) => visited.push(id));
    setLayout(ydoc, ids[0], "split");
    manager.undo();
    expect(visited).toEqual([]);
  });

  it("destroying the deck's undo removes its listeners", () => {
    const { undo, manager } = setup();
    undo.destroy();
    expect(listenerCount(manager)).toBe(0);
  });
});

describe("deleting a slide is a tombstone that undo reverses", () => {
  it("delete then undo brings the slide back, and a peer keeps typing into it in between", () => {
    const { ydoc, manager, ids, b } = setup();
    deleteSlide(ydoc, ids[1]);
    expect(visibleSlideIds(ydoc)).toEqual([ids[0], ids[2]]);
    expect(slidesMap(ydoc).has(ids[1])).toBe(true);
    type(b.editor, "still typing");
    expect(slideFragment(ydoc, ids[1], "title")!.toString()).toContain("still typing");
    manager.stopCapturing();
    manager.undo();
    manager.undo();
    expect(visibleSlideIds(ydoc)).toEqual(ids);
    undeleteSlide(ydoc, ids[1]);
    moveSlide(ydoc, ids[2], 0);
    expect(visibleSlideIds(ydoc)).toEqual([ids[2], ids[0], ids[1]]);
  });
});

describe("creating a slide is undoable without removing it", () => {
  it("undo tombstones an added or duplicated slide, redo restores it, and a peer's typing survives both", () => {
    const { ydoc, manager, ids } = setup();
    manager.clear();
    let added = "";
    deckUndoStep(manager, () => (added = addSlide(ydoc, "content", ids[2])));
    let copy = "";
    deckUndoStep(manager, () => (copy = duplicateSlide(ydoc, ids[0])!));
    expect(manager.undoStack).toHaveLength(2);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    blocksToFragment([{ type: "paragraph", content: "peer text" }] as never, slideFragment(peer, added, "title")!);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer), "remote");
    manager.undo();
    manager.undo();
    expect(visibleSlideIds(ydoc)).not.toContain(added);
    expect(visibleSlideIds(ydoc)).not.toContain(copy);
    expect(slidesMap(ydoc).has(added)).toBe(true);
    expect(slidesMap(ydoc).get(added)!.get("deleted")).toBe(true);
    manager.redo();
    manager.redo();
    expect(visibleSlideIds(ydoc)).toContain(added);
    expect(visibleSlideIds(ydoc)).toContain(copy);
    expect(readDeck(ydoc).slides.find((x) => x.id === added)!.elements.find((e) => e.slot === "title")!.text).toBe("peer text");
  });

  it("later edits to the new slide can still be undone", () => {
    const { ydoc, manager, ids } = setup();
    manager.clear();
    const added = addSlide(ydoc, "content", ids[2]);
    setLayout(ydoc, added, "split");
    manager.undo();
    expect(slidesMap(ydoc).get(added)!.get("layoutId")).toBe("content");
    expect(slidesMap(ydoc).has(added)).toBe(true);
  });
});

function deckUndoStep(manager: Y.UndoManager, fn: () => void) {
  manager.stopCapturing();
  fn();
  manager.stopCapturing();
}
