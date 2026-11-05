import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { getRelativeSelection } from "y-prosemirror";
import * as Y from "yjs";

type SyncState = { binding?: unknown } | undefined;

function findSyncPlugin(state: EditorState): Plugin | undefined {
  return state.plugins.find((p) => p.key.startsWith("y-sync"));
}

function syncState(state: EditorState): SyncState {
  const p = findSyncPlugin(state);
  return p ? (p.getState(state) as SyncState) : undefined;
}

export function createDeckUndoManager(slides: Y.AbstractType<unknown>, localOrigins: unknown[]): Y.UndoManager {
  return new Y.UndoManager(slides, {
    trackedOrigins: new Set(localOrigins),
    captureTimeout: 500,
    captureTransaction: (tr) => tr.meta.get("addToHistory") !== false,
  });
}

export function listenerCount(um: Y.UndoManager): number {
  const obs = (um as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  let n = 0;
  obs.forEach((s) => (n += s.size));
  return n;
}

const deckUndoKey = new PluginKey<{ prevSel: unknown }>("deckUndo");

type StackEvent = { stackItem: { meta: Map<unknown, unknown> } };

/**
 * Shared-manager replacement for y-prosemirror's yUndoPlugin. Never destroys the manager (yUndoPlugin's
 * view.destroy would kill the deck stack when one slide editor unmounts), removes its own listeners on
 * destroy, and finds the sync plugin by key prefix, adding that plugin's own key object as a tracked
 * origin so it works even if y-prosemirror is inlined twice.
 */
export function deckUndoPlugin(deckUndo: Y.UndoManager): Plugin {
  const run = (fn: () => unknown) => fn() != null;
  return new Plugin({
    key: deckUndoKey,
    state: {
      init: () => ({ prevSel: null }),
      apply: (_tr, val, oldState, state) => {
        const binding = syncState(state)?.binding;
        if (!binding) return val;
        return { prevSel: getRelativeSelection(binding as never, oldState) };
      },
    },
    props: {
      handleKeyDown(_view, event) {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
        const k = event.key.toLowerCase();
        if (k === "z" && !event.shiftKey) return run(() => deckUndo.undo());
        if ((k === "z" && event.shiftKey) || k === "y") return run(() => deckUndo.redo());
        return false;
      },
    },
    view(view) {
      const origin = (findSyncPlugin(view.state)?.spec as { key?: unknown } | undefined)?.key;
      if (origin) deckUndo.addTrackedOrigin(origin);
      const onAdded = ({ stackItem }: StackEvent) => {
        const binding = syncState(view.state)?.binding;
        if (binding) stackItem.meta.set(binding, deckUndoKey.getState(view.state)?.prevSel);
      };
      const onPopped = ({ stackItem }: StackEvent) => {
        const binding = syncState(view.state)?.binding as { beforeTransactionSelection?: unknown } | undefined;
        if (binding) binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
      };
      deckUndo.on("stack-item-added", onAdded as never);
      deckUndo.on("stack-item-popped", onPopped as never);
      return {
        destroy() {
          deckUndo.off("stack-item-added", onAdded as never);
          deckUndo.off("stack-item-popped", onPopped as never);
        },
      };
    },
  });
}

export function deckUndoExtension(deckUndo: Y.UndoManager) {
  return { key: "deckUndo", prosemirrorPlugins: [deckUndoPlugin(deckUndo)], runsBefore: ["default"] };
}
