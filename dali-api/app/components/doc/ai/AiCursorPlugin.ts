// AI streaming cursor plugin — renders a widget decoration styled as a
// BlockNote collaboration caret (same classes, violet color) at the end of
// the last AI-owned block. Registered while streaming via editor.registerExtension;
// unregistered when streaming ends.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node } from "prosemirror-model";
import type { DocEditorInstance } from "../schema/build";

export interface AiCursorPluginState {
  /** ProseMirror document position of the cursor (end of last AI block). -1 = hidden. */
  pos: number;
  decorations: DecorationSet;
}

export interface AiCursorUpdate {
  pos: number;
}

export const aiCursorKey = new PluginKey<AiCursorPluginState>("dali-ai-cursor");

const AI_CURSOR_COLOR = "#8b5cf6"; // violet-500

function buildDecoration(doc: Node, pos: number): DecorationSet {
  if (pos < 0 || pos > doc.content.size) return DecorationSet.empty;

  // Widget decoration: a fake caret rendered as a BlockNote collab cursor.
  const widget = Decoration.widget(pos, () => {
    const base = document.createElement("span");
    base.className = "bn-collaboration-cursor__base dali-ai-cursor";
    base.style.setProperty("--bn-user-color", AI_CURSOR_COLOR);

    const caret = document.createElement("span");
    caret.className = "bn-collaboration-cursor__caret";

    const label = document.createElement("span");
    label.className = "bn-collaboration-cursor__label";
    label.textContent = "AI";

    caret.appendChild(label);
    base.appendChild(caret);
    return base;
  }, { side: 1 });

  return DecorationSet.create(doc, [widget]);
}

export function createAiCursorPlugin(): Plugin<AiCursorPluginState> {
  return new Plugin<AiCursorPluginState>({
    key: aiCursorKey,

    state: {
      init(_config, state) {
        return { pos: -1, decorations: DecorationSet.empty };
      },

      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(aiCursorKey) as AiCursorUpdate | undefined;
        if (meta) {
          const decorations = buildDecoration(newState.doc, meta.pos);
          return { pos: meta.pos, decorations };
        }
        // Map through document changes.
        const pos = tr.docChanged ? tr.mapping.map(pluginState.pos) : pluginState.pos;
        const decorations = pos !== pluginState.pos
          ? buildDecoration(newState.doc, pos)
          : pluginState.decorations.map(tr.mapping, newState.doc);
        return { pos, decorations };
      },
    },

    props: {
      decorations(state) {
        return aiCursorKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Find the ProseMirror position at the END of the last block with the given id.
 * Returns -1 if the block is not found.
 */
export function findBlockEndPos(editor: DocEditorInstance, blockId: string): number {
  const view = editor.prosemirrorView;
  if (!view) return -1;
  const doc = view.state.doc;
  let found = -1;
  doc.descendants((node, pos) => {
    // BlockNote blocks are mapped to PM nodes with a data-id attribute.
    // The node's attrs carry `id` (BlockNote serializes block ids as PM attrs).
    if (node.attrs?.id === blockId) {
      found = pos + node.nodeSize - 1;
      return false; // stop descending into this node
    }
    return true;
  });
  return found;
}
