import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { getRelativeSelection } from "y-prosemirror";
import * as Y from "yjs";
import { DECK_LOCAL } from "./deck-ops";

type SyncState = { binding?: unknown } | undefined;

function findSyncPlugin(state: EditorState): Plugin | undefined {
  return state.plugins.find((p) => p.key.startsWith("y-sync"));
}

function syncState(state: EditorState): SyncState {
  const p = findSyncPlugin(state);
  return p ? (p.getState(state) as SyncState) : undefined;
}

export const SLIDE_META = "slideId";

type StackEvent = { stackItem: { meta: Map<unknown, unknown> }; type: "undo" | "redo" };

export interface DeckUndo {
  manager: Y.UndoManager;
  /** Called with the slide a change was made on, after an undo or redo of it. */
  setNavigator(fn: ((slideId: string) => void) | null): void;
  /** Reports which slide the user is on, so new history entries remember it. */
  setCurrentSlide(id: string | null): void;
  destroy(): void;
}

/**
 * One manager for the whole deck, over the slides map and the deck map. Local origins are the deck's own
 * transactions; each text editor's sync plugin adds its own origin when it mounts.
 */
export function createDeckUndo(scope: Y.AbstractType<unknown>[], localOrigins: unknown[] = [DECK_LOCAL]): DeckUndo {
  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set(localOrigins),
    captureTimeout: 500,
    captureTransaction: (tr) => tr.meta.get("addToHistory") !== false,
  });
  let current: string | null = null;
  let navigate: ((slideId: string) => void) | null = null;
  const onAdded = ({ stackItem }: StackEvent) => {
    if (current && !stackItem.meta.has(SLIDE_META)) stackItem.meta.set(SLIDE_META, current);
  };
  const onPopped = ({ stackItem, type }: StackEvent) => {
    const slideId = stackItem.meta.get(SLIDE_META);
    if (typeof slideId !== "string") return;
    const opposite = type === "undo" ? manager.redoStack : manager.undoStack;
    opposite[opposite.length - 1]?.meta.set(SLIDE_META, slideId);
    navigate?.(slideId);
  };
  manager.on("stack-item-added", onAdded as never);
  manager.on("stack-item-popped", onPopped as never);
  return {
    manager,
    setNavigator: (fn) => (navigate = fn),
    setCurrentSlide: (id) => (current = id),
    destroy() {
      manager.off("stack-item-added", onAdded as never);
      manager.off("stack-item-popped", onPopped as never);
      manager.destroy();
    },
  };
}

export function listenerCount(um: Y.UndoManager): number {
  const obs = (um as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  let n = 0;
  obs.forEach((s) => (n += s.size));
  return n;
}

const deckUndoKey = new PluginKey<{ prevSel: unknown }>("deckUndo");

/**
 * Shared-manager replacement for y-prosemirror's yUndoPlugin. The stock plugin destroys its manager when one
 * editor unmounts, which would end the deck's history. This one removes only its own listeners, and finds the
 * sync plugin by key prefix so it works even when y-prosemirror is bundled twice.
 */
export function deckUndoPlugin(manager: Y.UndoManager): Plugin {
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
        if (k === "z" && !event.shiftKey) return run(() => manager.undo());
        if ((k === "z" && event.shiftKey) || k === "y") return run(() => manager.redo());
        return false;
      },
    },
    view(view) {
      const origin = (findSyncPlugin(view.state)?.spec as { key?: unknown } | undefined)?.key;
      if (origin) manager.addTrackedOrigin(origin);
      const onAdded = ({ stackItem }: StackEvent) => {
        const binding = syncState(view.state)?.binding;
        if (binding) stackItem.meta.set(binding, deckUndoKey.getState(view.state)?.prevSel);
      };
      const onPopped = ({ stackItem }: StackEvent) => {
        const binding = syncState(view.state)?.binding as { beforeTransactionSelection?: unknown } | undefined;
        if (binding) binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
      };
      manager.on("stack-item-added", onAdded as never);
      manager.on("stack-item-popped", onPopped as never);
      return {
        destroy() {
          manager.off("stack-item-added", onAdded as never);
          manager.off("stack-item-popped", onPopped as never);
        },
      };
    },
  });
}

export function deckUndoExtension(manager: Y.UndoManager) {
  return { key: "deckUndo", prosemirrorPlugins: [deckUndoPlugin(manager)], runsBefore: ["default"] };
}
