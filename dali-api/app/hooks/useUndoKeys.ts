import { useEffect, useRef } from "react";
import { OPEN_DIALOG_SELECTOR, undoKeyIntent } from "~/components/drive/undo-keys";

export type UndoKeyHistory = {
  undo: () => unknown;
  redo: () => unknown;
  canUndo: boolean | (() => boolean);
  canRedo: boolean | (() => boolean);
};

const available = (can: boolean | (() => boolean)) => (typeof can === "function" ? can() : can);

/** Cmd or Ctrl+Z and the redo chords drive `history` for as long as the host is mounted. */
export function useUndoKeys(history: UndoKeyHistory): void {
  const ref = useRef(history);
  ref.current = history;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const intent = undoKeyIntent(e, { dialogOpen: document.querySelector(OPEN_DIALOG_SELECTOR) !== null });
      if (!intent) return;
      const h = ref.current;
      if (!available(intent === "undo" ? h.canUndo : h.canRedo)) return;
      e.preventDefault();
      void (intent === "undo" ? h.undo() : h.redo());
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
