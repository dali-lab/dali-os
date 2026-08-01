// AI streaming cursor plugin — renders a self-contained caret widget decoration
// at the write-head position while streaming, node decorations highlighting
// AI-owned blocks (pending-accept state) during streaming AND result phases,
// and a flow-spacer widget after the anchor block so following content is
// pushed down instead of occluded by the floating AI card.
// Registered for the entire AI bar lifetime (not just during a run); unregistered
// on bar close (Accept/Revert/discard/unmount). The spacer is needed even in the
// idle phase so the bar never overlays document content below the anchor.

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
  /**
   * Block ID after which the flow-spacer widget is placed. The spacer reserves
   * document flow space equal to the AI card stack's measured height so
   * following content is pushed down instead of occluded by the floating card.
   * null = no spacer (modal fallback or bar not yet anchored).
   */
  spacerAfterBlockId: string | null;
  decorations: DecorationSet;
}

export interface AiCursorUpdate {
  /** If provided, update the caret position. */
  pos?: number;
  /** If provided, update the pending block id set. */
  pendingBlockIds?: string[];
  /** If provided, update the spacer anchor block id. */
  spacerAfterBlockId?: string | null;
}

export const aiCursorKey = new PluginKey<AiCursorPluginState>("dali-ai-cursor");

function buildDecorations(
  doc: Node,
  pos: number,
  pendingBlockIds: string[],
  spacerAfterBlockId: string | null,
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

  // ── Pending-block node decorations + spacer ──────────────────────────────────
  const pendingIdSet = pendingBlockIds.length > 0 ? new Set(pendingBlockIds) : null;
  const needSpacer = spacerAfterBlockId !== null;

  if (pendingIdSet || needSpacer) {
    doc.descendants((node, nodePos) => {
      const blockId = node.attrs?.id as string | undefined;
      if (pendingIdSet && blockId && pendingIdSet.has(blockId)) {
        decos.push(
          Decoration.node(nodePos, nodePos + node.nodeSize, {
            class: "dali-ai-pending",
          }),
        );
        // Don't return false — there may be nested blocks with matching ids,
        // though in practice BlockNote uses flat block ids.
      }
      if (needSpacer && blockId === spacerAfterBlockId) {
        // Place the spacer widget immediately AFTER the anchor block's node
        // (pos + nodeSize). side:1 puts it after content at that position.
        // The stable key prevents PM from re-creating the div on every update,
        // which would cause a flash — PM reuses the DOM node as long as key
        // and position match.
        const spacerPos = nodePos + node.nodeSize;
        if (spacerPos <= doc.content.size) {
          decos.push(
            Decoration.widget(
              spacerPos,
              () => {
                const spacer = document.createElement("div");
                spacer.className = "dali-ai-spacer";
                spacer.contentEditable = "false";
                return spacer;
              },
              { side: 1, key: "dali-ai-spacer" },
            ),
          );
        }
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
        return {
          pos: -1,
          pendingBlockIds: [],
          spacerAfterBlockId: null,
          decorations: DecorationSet.empty,
        };
      },

      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(aiCursorKey) as AiCursorUpdate | undefined;
        if (meta) {
          const pos = meta.pos !== undefined ? meta.pos : pluginState.pos;
          const pendingBlockIds =
            meta.pendingBlockIds !== undefined
              ? meta.pendingBlockIds
              : pluginState.pendingBlockIds;
          const spacerAfterBlockId =
            meta.spacerAfterBlockId !== undefined
              ? meta.spacerAfterBlockId
              : pluginState.spacerAfterBlockId;
          const decorations = buildDecorations(newState.doc, pos, pendingBlockIds, spacerAfterBlockId);
          return { pos, pendingBlockIds, spacerAfterBlockId, decorations };
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
          pluginState.spacerAfterBlockId,
        );
        return {
          pos: mappedPos,
          pendingBlockIds: pluginState.pendingBlockIds,
          spacerAfterBlockId: pluginState.spacerAfterBlockId,
          decorations,
        };
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
