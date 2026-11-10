// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { AllSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { CellSelection } from "@tiptap/pm/tables";
import { createSelectAllPlugin, wholeDocumentSelection } from "./select-all";

const divider: PartialBlock = { type: "divider" };
const para = (text: string): PartialBlock => ({ type: "paragraph", content: text });
const cell = (text: string) => ({ type: "tableCell" as const, content: text, props: {} });
const table: PartialBlock = {
  type: "table",
  content: {
    type: "tableContent",
    rows: [{ cells: [cell("A1"), cell("B1")] }, { cells: [cell("A2"), cell("B2")] }],
  },
};

function press(blocks: PartialBlock[], init: KeyboardEventInit) {
  const plugin = createSelectAllPlugin();
  let state: EditorState = BlockNoteEditor.create({ initialContent: blocks }).prosemirrorState;
  const dispatch = vi.fn((tr: Transaction) => {
    state = state.apply(tr);
  });
  const view = {
    get state() {
      return state;
    },
    dispatch,
  } as unknown as EditorView;
  const handled = plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent("keydown", init));
  return { handled, dispatch, selection: () => state.selection, doc: () => state.doc };
}

// jsdom reports a non-Mac platform, so Mod resolves to Ctrl here and in CI.
describe("createSelectAllPlugin", () => {
  it.each([
    ["only text", [para("one"), para("two")]],
    ["a leading divider", [divider, para("after")]],
    ["a trailing divider", [para("before"), divider]],
    ["a leading table", [table, para("after")]],
    ["a trailing table", [para("before"), table]],
    ["a table between dividers", [divider, table, divider]],
  ])("selects the whole document with %s", (_label, blocks) => {
    const result = press(blocks, { key: "a", ctrlKey: true });

    expect(result.handled).toBe(true);
    expect(result.selection()).toBeInstanceOf(AllSelection);
    expect(result.selection().from).toBe(0);
    expect(result.selection().to).toBe(result.doc().content.size);
  });

  it.each([
    ["plain a", { key: "a" }],
    ["shift+mod+a", { key: "A", ctrlKey: true, shiftKey: true }],
    ["alt+mod+a", { key: "a", ctrlKey: true, altKey: true }],
    ["mod+b", { key: "b", ctrlKey: true }],
  ])("leaves %s alone", (_label, init) => {
    const result = press([para("one")], init);

    expect(result.handled).toBe(false);
    expect(result.dispatch).not.toHaveBeenCalled();
  });
});

describe("wholeDocumentSelection", () => {
  it("selects every cell when a table is the only block", () => {
    const { doc } = BlockNoteEditor.create({ initialContent: [table] }).prosemirrorState;

    const selection = wholeDocumentSelection(doc);

    expect(selection).toBeInstanceOf(CellSelection);
    const cells: string[] = [];
    (selection as CellSelection).forEachCell((node) => cells.push(node.textContent));
    expect(cells).toEqual(["A1", "B1", "A2", "B2"]);
  });
});
