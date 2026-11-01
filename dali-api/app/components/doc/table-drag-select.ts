// Mouse selection through tables. prosemirror-tables pins any drag that starts
// in a cell to that table, and the space beside a table has no text position,
// so browsers lose the selection there. Both cases are taken over here: the
// table is selected whole, and the other end follows the pointer.

import type { Node, ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey, Selection, TextSelection } from "prosemirror-state";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import type { EditorView } from "prosemirror-view";

export type TableRange = { start: number; end: number };

export function tableAround($pos: ResolvedPos): TableRange | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole === "table") {
      return { start: $pos.before(depth), end: $pos.after(depth) };
    }
  }
  return null;
}

// Text just outside the table, falling back to its own first or last cell when
// nothing is on that side. Outside is preferred because prosemirror-tables
// collapses a text selection that ends at offset 0 and has one end in a cell.
function edgeOfTable(doc: Node, table: TableRange, dir: 1 | -1): number {
  const from = doc.resolve(dir > 0 ? table.end : table.start);
  const edge = Selection.findFrom(from, dir, true) ?? Selection.findFrom(from, -dir as 1 | -1, true);
  return edge ? edge.head : from.pos;
}

function lastTextInTable(doc: Node, table: TableRange): number {
  return Selection.findFrom(doc.resolve(table.end), -1, true)?.head ?? table.end;
}

/** Whole table plus everything from it to `headPos`, or null if `headPos` is inside it. */
export function selectionFromTableTo(doc: Node, table: TableRange, headPos: number): Selection | null {
  if (headPos > table.start && headPos < table.end) return null;
  const anchor = edgeOfTable(doc, table, headPos < table.start ? 1 : -1);
  const anchorInTable = anchor > table.start && anchor < table.end;
  const $head = doc.resolve(headPos);
  const head = anchorInTable && headPos >= table.end && $head.parentOffset === 0 ? lastTextInTable(doc, table) : headPos;
  return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
}

/** Selection for a drag from text to the space beside a table, which reads as a table-level position. */
export function selectionToBesideTable($anchor: ResolvedPos, $head: ResolvedPos): Selection | null {
  if ($head.parent.type.spec.tableRole !== "table") return null;
  const table = tableAround($head);
  if (!table || tableAround($anchor)?.start === table.start) return null;
  const head = edgeOfTable($head.doc, table, $anchor.pos < table.start ? 1 : -1);
  return TextSelection.between($anchor, $head.doc.resolve(head));
}

function resizingColumn(view: EditorView): boolean {
  return Boolean(columnResizingPluginKey.getState(view.state)?.dragging);
}

export function createTableDragSelectPlugin(): Plugin {
  let draggingOut = false;

  function trackDrag(view: EditorView, startEvent: MouseEvent) {
    const start = view.posAtCoords({ left: startEvent.clientX, top: startEvent.clientY });
    const table = start && tableAround(view.state.doc.resolve(start.pos));
    if (!table) return;

    const move = (event: Event) => {
      const { clientX, clientY } = event as MouseEvent;
      if (resizingColumn(view)) return;
      const head = view.posAtCoords({ left: clientX, top: clientY });
      if (!head) return;
      const selection = selectionFromTableTo(view.state.doc, table, head.pos);
      if (!selection) return;
      draggingOut = true;
      if (!view.state.selection.eq(selection)) view.dispatch(view.state.tr.setSelection(selection));
    };
    const stop = () => {
      draggingOut = false;
      view.root.removeEventListener("mousemove", move);
      view.root.removeEventListener("mouseup", stop);
      view.root.removeEventListener("dragstart", stop);
    };
    view.root.addEventListener("mousemove", move);
    view.root.addEventListener("mouseup", stop);
    view.root.addEventListener("dragstart", stop);
  }

  return new Plugin({
    key: new PluginKey("tableDragSelect"),
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return false;
          if ((event.target as Element).closest?.(".tableWrapper")) trackDrag(view, event);
          return false;
        },
      },
      createSelectionBetween(view, $anchor, $head) {
        if (draggingOut) return view.state.selection;
        return selectionToBesideTable($anchor, $head);
      },
    },
  });
}
