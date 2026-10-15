import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useToast } from "~/components/ui/toast";
import {
  emptyStack,
  markRedone,
  markUndone,
  peekRedo,
  peekUndo,
  pushEntry,
  stackView,
  type UndoEntry,
} from "~/components/drive/undo-stack";
import { OPEN_DIALOG_SELECTOR, undoKeyIntent } from "~/components/drive/undo-keys";

export type DriveHistory = {
  /** Remember an action that just happened. Returns the entry so a toast can undo exactly this one. */
  record: (entry: UndoEntry) => UndoEntry;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** The toast's Undo: reverses `entry` itself, which is the latest action unless something has happened since. */
  undoEntry: (entry: UndoEntry) => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

/** Offered by the Drive host so a picker rendered deeper in the tree can record into the same history. */
export const DriveHistoryContext = createContext<DriveHistory | null>(null);

export function useDriveHistoryContext(): DriveHistory | null {
  return useContext(DriveHistoryContext);
}

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * The Drive's undo and redo history. The methods are stable, and nothing
 * renders from the stack, so it lives in a ref. `onChange` runs after every
 * undo or redo that took effect (the host revalidates there).
 */
export function useDriveHistory({ onChange }: { onChange?: () => void } = {}): DriveHistory {
  const toast = useToast();
  const stack = useRef(emptyStack);
  const busy = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const run = useCallback(async (entry: UndoEntry | null, direction: "undo" | "redo") => {
    if (!entry || busy.current) return;
    busy.current = true;
    try {
      await entry[direction]();
      stack.current = (direction === "undo" ? markUndone : markRedone)(stack.current, entry);
      const custom = direction === "undo" ? entry.undoneMessage : entry.redoneMessage;
      toastRef.current.info(custom ?? `${entry.label} ${direction === "undo" ? "undone" : "redone"}`);
    } catch (err) {
      toastRef.current.error(message(err, direction === "undo" ? "Couldn't undo that" : "Couldn't redo that"));
    } finally {
      busy.current = false;
      onChangeRef.current?.();
    }
  }, []);

  return useMemo<DriveHistory>(
    () => ({
      record: (entry) => {
        stack.current = pushEntry(stack.current, entry);
        return entry;
      },
      undo: () => run(peekUndo(stack.current), "undo"),
      redo: () => run(peekRedo(stack.current), "redo"),
      undoEntry: (entry) => run(stack.current.past.includes(entry) ? entry : null, "undo"),
      canUndo: () => stackView(stack.current).canUndo,
      canRedo: () => stackView(stack.current).canRedo,
    }),
    [run],
  );
}

/** Cmd or Ctrl+Z and the redo chords drive `history` for as long as the host is mounted. */
export function useDriveHistoryKeys(history: DriveHistory): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const intent = undoKeyIntent(e, { dialogOpen: document.querySelector(OPEN_DIALOG_SELECTOR) !== null });
      if (!intent) return;
      const available = intent === "undo" ? history.canUndo() : history.canRedo();
      if (!available) return;
      e.preventDefault();
      void (intent === "undo" ? history.undo() : history.redo());
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [history]);
}
