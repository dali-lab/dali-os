import { keymap } from "@tiptap/pm/keymap";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { Node } from "prosemirror-model";
import { AllSelection, type Command, type Selection } from "prosemirror-state";

function isLoneTable(doc: Node): boolean {
  const group = doc.firstChild;
  const block = group?.childCount === 1 ? group.firstChild : null;
  return block?.childCount === 1 && block.firstChild?.type.spec.tableRole === "table";
}

// BlockNote's text-align button throws on AllSelection when the only selected
// block is a table, which unmounts the editor, so that document selects its cells.
export function wholeDocumentSelection(doc: Node): Selection {
  if (!isLoneTable(doc)) return new AllSelection(doc);
  const tablePos = 2; // doc > blockGroup > blockContainer > table
  const { map } = TableMap.get(doc.nodeAt(tablePos)!);
  const start = tablePos + 1;
  return CellSelection.create(doc, start + map[0], start + map[map.length - 1]);
}

const selectWholeDocument: Command = (state, dispatch) => {
  dispatch?.(state.tr.setSelection(wholeDocumentSelection(state.doc)));
  return true;
};

// BlockNote turns off Tiptap's core keymap, which is where Mod-a normally lives.
// Native select-all then collapses to a cursor when the document starts or ends
// with a block that holds no plain text, such as a divider, embed or callout.
export function createSelectAllPlugin() {
  return keymap({ "Mod-a": selectWholeDocument });
}
