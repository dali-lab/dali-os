// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import type { EditorView } from "prosemirror-view";
import {
  createTableDragSelectPlugin,
  selectionFromTableTo,
  selectionToBesideTable,
  tableAround,
  type TableRange,
} from "./table-drag-select";

const cell = (text: string) => ({ type: "tableCell" as const, content: text, props: {} });
const table: PartialBlock = {
  type: "table",
  content: {
    type: "tableContent",
    rows: [{ cells: [cell("A1"), cell("B1")] }, { cells: [cell("A2"), cell("B2")] }],
  },
};
const para = (text: string): PartialBlock => ({ type: "paragraph", content: text });

function buildState(blocks: PartialBlock[]): EditorState {
  return BlockNoteEditor.create({ initialContent: blocks }).prosemirrorState;
}

function posOf(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text);
  });
  if (found === -1) throw new Error(`"${text}" not in doc`);
  return found;
}

function tableIn(doc: Node): TableRange {
  const range = tableAround(doc.resolve(posOf(doc, "A1")));
  if (!range) throw new Error("no table");
  return range;
}

function selectedText(doc: Node, selection: { from: number; to: number } | null | undefined): string {
  return selection ? doc.textBetween(selection.from, selection.to, "|") : "";
}

describe("tableAround", () => {
  it("finds the enclosing table from a cell, and nothing from a paragraph", () => {
    const { doc } = buildState([para("above"), table, para("below")]);

    expect(tableAround(doc.resolve(posOf(doc, "B2")))).not.toBeNull();
    expect(tableAround(doc.resolve(posOf(doc, "above")))).toBeNull();
  });
});

describe("selectionFromTableTo", () => {
  it("selects the whole table and the text down to the pointer", () => {
    const { doc } = buildState([para("above"), table, para("below text")]);

    const selection = selectionFromTableTo(doc, tableIn(doc), posOf(doc, "below text") + 5);

    expect(selectedText(doc, selection)).toBe("|A1|B1|A2|B2|below");
  });

  it("selects the whole table and the text up to the pointer", () => {
    const { doc } = buildState([para("above text"), table, para("below")]);

    const selection = selectionFromTableTo(doc, tableIn(doc), posOf(doc, "above text") + 6);

    expect(selectedText(doc, selection)).toBe("text|A1|B1|A2|B2|");
  });

  it("returns null while the pointer is inside the table", () => {
    const { doc } = buildState([para("above"), table, para("below")]);

    expect(selectionFromTableTo(doc, tableIn(doc), posOf(doc, "B1"))).toBeNull();
  });

  it("starts in the first cell when the table opens the document", () => {
    const { doc } = buildState([table, para("below text")]);

    const selection = selectionFromTableTo(doc, tableIn(doc), posOf(doc, "below text") + 5);

    expect(selectedText(doc, selection)).toBe("A1|B1|A2|B2|below");
  });

  it("stays on the table when the pointer stops at offset 0 and the table opens the document", () => {
    const state = buildState([table, para("below")]);
    const { doc } = state;

    const selection = selectionFromTableTo(doc, tableIn(doc), posOf(doc, "below"));

    expect(selectedText(doc, selection)).toBe("A1|B1|A2|B2");
    expect(selectedText(doc, state.apply(state.tr.setSelection(selection!)).selection)).toBe("A1|B1|A2|B2");
  });
});

describe("selectionToBesideTable", () => {
  const tableLevelPos = (doc: Node) => tableIn(doc).start + 1;

  it("takes in the whole table when dragging down from above", () => {
    const { doc } = buildState([para("above text"), table, para("below")]);

    const selection = selectionToBesideTable(doc.resolve(posOf(doc, "above text") + 6), doc.resolve(tableLevelPos(doc)));

    expect(selectedText(doc, selection)).toBe("text|A1|B1|A2|B2|");
  });

  it("takes in the whole table when dragging up from below", () => {
    const { doc } = buildState([para("above"), table, para("below text")]);

    const selection = selectionToBesideTable(doc.resolve(posOf(doc, "below text") + 5), doc.resolve(tableLevelPos(doc)));

    expect(selectedText(doc, selection)).toBe("|A1|B1|A2|B2|below");
  });

  it("ignores a head in ordinary text", () => {
    const { doc } = buildState([para("above"), table, para("below")]);

    expect(selectionToBesideTable(doc.resolve(posOf(doc, "above")), doc.resolve(posOf(doc, "below")))).toBeNull();
  });

  it("ignores an anchor already in the same table", () => {
    const { doc } = buildState([para("above"), table, para("below")]);

    expect(selectionToBesideTable(doc.resolve(posOf(doc, "B1")), doc.resolve(tableLevelPos(doc)))).toBeNull();
  });
});

describe("createTableDragSelectPlugin", () => {
  function setup(startText = "B2") {
    const plugin = createTableDragSelectPlugin();
    let state = buildState([para("above"), table, para("below text")]);
    const root = new EventTarget();
    let pointer = posOf(state.doc, startText);
    const dispatch = vi.fn((tr: Transaction) => {
      state = state.apply(tr);
    });
    const view = {
      get state() {
        return state;
      },
      root,
      dispatch,
      posAtCoords: () => ({ pos: pointer, inside: -1 }),
    } as unknown as EditorView;
    const target = document.createElement("div");
    target.className = "tableWrapper";
    const down = (init: MouseEventInit = {}, el: Element = target) => {
      const event = new MouseEvent("mousedown", { button: 0, ...init });
      Object.defineProperty(event, "target", { value: el });
      return plugin.props.handleDOMEvents!.mousedown!.call(plugin, view, event);
    };
    return {
      plugin,
      view,
      dispatch,
      root,
      down,
      doc: () => state.doc,
      selection: () => state.selection,
      moveTo(pos: number) {
        pointer = pos;
        root.dispatchEvent(new MouseEvent("mousemove"));
      },
      between(anchor: number, head: number) {
        const { doc } = state;
        return plugin.props.createSelectionBetween!.call(plugin, view, doc.resolve(anchor), doc.resolve(head));
      },
    };
  }

  it("selects through the table once the pointer leaves it", () => {
    const t = setup();
    t.down();

    t.moveTo(posOf(t.doc(), "below text") + 5);

    expect(t.selection()).toBeInstanceOf(TextSelection);
    expect(selectedText(t.doc(), t.selection())).toBe("|A1|B1|A2|B2|below");
  });

  it("leaves the selection alone while the pointer stays in the table", () => {
    const t = setup();
    t.down();

    t.moveTo(posOf(t.doc(), "B1"));

    expect(t.dispatch).not.toHaveBeenCalled();
  });

  it("does not redispatch an unchanged selection", () => {
    const t = setup();
    t.down();
    const head = posOf(t.doc(), "below text") + 5;

    t.moveTo(head);
    t.moveTo(head);

    expect(t.dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps its selection against the browser's during a drag, then lets go on mouseup", () => {
    const t = setup();
    t.down();
    t.moveTo(posOf(t.doc(), "below text") + 5);
    const above = posOf(t.doc(), "above");
    const below = posOf(t.doc(), "below");

    expect(t.between(above, below)).toBe(t.selection());

    t.root.dispatchEvent(new MouseEvent("mouseup"));
    expect(t.between(above, below)).toBeNull();
  });

  it.each(["mouseup", "dragstart"])("stops following the pointer after %s", (name) => {
    const t = setup();
    t.down();

    t.root.dispatchEvent(new Event(name));
    t.moveTo(posOf(t.doc(), "below text") + 5);

    expect(t.dispatch).not.toHaveBeenCalled();
  });

  it("stays out of the way of column resizing", () => {
    const t = setup();
    const getState = vi.spyOn(columnResizingPluginKey, "getState").mockReturnValue({
      activeHandle: 1,
      dragging: { startX: 0, startWidth: 100 },
    } as ReturnType<typeof columnResizingPluginKey.getState>);
    t.down();

    t.moveTo(posOf(t.doc(), "below text") + 5);

    expect(t.dispatch).not.toHaveBeenCalled();
    getState.mockRestore();
  });

  it.each([
    ["right button", { button: 2 }],
    ["shift", { shiftKey: true }],
    ["cmd", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
  ])("ignores a %s press", (_label, init) => {
    const t = setup();
    t.down(init);

    t.moveTo(posOf(t.doc(), "below text") + 5);

    expect(t.dispatch).not.toHaveBeenCalled();
  });

  it("ignores a press outside any table", () => {
    const t = setup("above");
    t.down({}, document.createElement("div"));

    t.moveTo(posOf(t.doc(), "below text") + 5);

    expect(t.dispatch).not.toHaveBeenCalled();
  });
});
