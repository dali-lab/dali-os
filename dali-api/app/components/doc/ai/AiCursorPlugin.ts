// AI streaming cursor plugin — renders a self-contained caret widget decoration
// at the write-head position while streaming, and node decorations highlighting
// AI-owned blocks (pending-accept state) during streaming AND result phases.
// Registered while the AI session is active; unregistered on Accept/Revert/close.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { DocEditorInstance } from "../schema/build";

export interface AiCursorPluginState {
  /** ProseMirror document position of the streaming caret. -1 = hidden. */
  pos: number;
  /** Block IDs that AI has written (pending accept/revert) — highlighted. */
  pendingBlockIds: string[];
  decorations: DecorationSet;
}

export interface AiCursorUpdate {
  /** If provided, update the caret position. */
  pos?: number;
  /** If provided, update the pending block id set. */
  pendingBlockIds?: string[];
}

export const aiCursorKey = new PluginKey<AiCursorPluginState>("dali-ai-cursor");

function buildDecorations(
  doc: Node,
  pos: number,
  pendingBlockIds: string[],
): DecorationSet {
  const decos: Decoration[] = [];

  // ── Caret widget ────────────────────────────────────────────────────────────
  if (pos >= 0 && pos <= doc.content.size) {
    const widget = Decoration.widget(
      pos,
      () => {
        const base = document.createElement("span");
        base.className = "dali-ai-caret";

        const bar = document.createElement("span");
        bar.className = "dali-ai-caret__bar";

        const chip = document.createElement("span");
        chip.className = "dali-ai-caret__chip";
        chip.textContent = "AI";

        base.appendChild(bar);
        base.appendChild(chip);
        return base;
      },
      { side: 1 },
    );
    decos.push(widget);
  }

  // ── Pending-block node decorations ──────────────────────────────────────────
  if (pendingBlockIds.length > 0) {
    const idSet = new Set(pendingBlockIds);
    doc.descendants((node, nodePos) => {
      if (node.attrs?.id && idSet.has(node.attrs.id as string)) {
        decos.push(
          Decoration.node(nodePos, nodePos + node.nodeSize, {
            class: "dali-ai-pending",
          }),
        );
        // Don't return false — there may be nested blocks with matching ids,
        // though in practice BlockNote uses flat block ids.
      }
      return true;
    });
  }

  if (decos.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decos);
}

export function createAiCursorPlugin(): Plugin<AiCursorPluginState> {
  return new Plugin<AiCursorPluginState>({
    key: aiCursorKey,

    state: {
      init(_config, state) {
        return { pos: -1, pendingBlockIds: [], decorations: DecorationSet.empty };
      },

      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(aiCursorKey) as AiCursorUpdate | undefined;
        if (meta) {
          const pos = meta.pos !== undefined ? meta.pos : pluginState.pos;
          const pendingBlockIds =
            meta.pendingBlockIds !== undefined
              ? meta.pendingBlockIds
              : pluginState.pendingBlockIds;
          const decorations = buildDecorations(newState.doc, pos, pendingBlockIds);
          return { pos, pendingBlockIds, decorations };
        }
        // Map positions through document changes.
        const mappedPos = tr.docChanged
          ? tr.mapping.map(pluginState.pos)
          : pluginState.pos;
        if (!tr.docChanged && mappedPos === pluginState.pos) {
          return pluginState;
        }
        const decorations = buildDecorations(
          newState.doc,
          mappedPos,
          pluginState.pendingBlockIds,
        );
        return { pos: mappedPos, pendingBlockIds: pluginState.pendingBlockIds, decorations };
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
 * Dispatch a partial update to the AI cursor plugin state.
 * Omit a field to leave it unchanged.
 */
export function updateAiPluginState(view: EditorView, update: AiCursorUpdate): void {
  const tr = view.state.tr.setMeta(aiCursorKey, update);
  view.dispatch(tr);
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
    if (node.attrs?.id === blockId) {
      found = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });
  return found;
}
