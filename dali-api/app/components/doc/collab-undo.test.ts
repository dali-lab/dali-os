// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { Plugin } from "prosemirror-state";
import * as Y from "yjs";
import { keepCollabUndoAlive } from "./collab-undo";

function collabEditor() {
  const ydoc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: { fragment: ydoc.getXmlFragment("doc"), user: { name: "Ada", color: "#336699" } },
    }),
  );
  keepCollabUndoAlive(editor);
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

const text = (editor: BlockNoteEditor) => editor.prosemirrorState.doc.textContent;

function typeThenUndo(editor: BlockNoteEditor) {
  editor.insertInlineContent("hello");
  expect(text(editor)).toBe("hello");
  editor.undo();
  return text(editor);
}

describe("keepCollabUndoAlive", () => {
  it("undoes typing in a collaborative editor", () => {
    expect(typeThenUndo(collabEditor())).toBe("");
  });

  it("keeps undo working after an extension is registered", () => {
    const editor = collabEditor();
    editor.registerExtension({ key: "extra", prosemirrorPlugins: [new Plugin({})] });
    expect(typeThenUndo(editor)).toBe("");
  });

  it("keeps undo working after an extension is registered and removed", () => {
    const editor = collabEditor();
    editor.registerExtension({ key: "find", prosemirrorPlugins: [new Plugin({})] });
    editor.unregisterExtension("find");
    expect(typeThenUndo(editor)).toBe("");
  });

  it("keeps undo working after the editor remounts", () => {
    const editor = collabEditor();
    editor.unmount();
    const el = document.createElement("div");
    document.body.appendChild(el);
    editor.mount(el);
    expect(typeThenUndo(editor)).toBe("");
  });
});
