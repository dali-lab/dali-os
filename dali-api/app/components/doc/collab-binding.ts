import type * as Y from "yjs";
import { BLOCKNOTE_FRAGMENT } from "./schema/configs";

export interface CollabBindingInput {
  fragment?: Y.XmlFragment;
  undoExtension?: unknown;
}

/** The fragment an editor binds to: the host's, or the document's own "blocknote" body. */
export function resolveFragment(ydoc: Y.Doc, input: Pick<CollabBindingInput, "fragment">): Y.XmlFragment {
  return input.fragment ?? ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT);
}

/** Options for withCollaboration when the host owns undo: BlockNote's per-editor undo is switched off and the host's takes its place. */
export function undoOptions(input: Pick<CollabBindingInput, "undoExtension">): { extensions: unknown[]; disableExtensions?: string[] } {
  return input.undoExtension ? { extensions: [input.undoExtension], disableExtensions: ["yUndo"] } : { extensions: [] };
}
