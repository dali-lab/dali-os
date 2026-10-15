export type UndoEntry = {
  /** What the action was, as a noun ("Move", "Filing"); the default undone and redone messages are built from it. */
  label: string;
  /** Throws, with a sentence for the user, when it could not reverse the action. */
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  undoneMessage?: string;
  redoneMessage?: string;
};

export type UndoStack = { past: UndoEntry[]; future: UndoEntry[] };

export const UNDO_LIMIT = 20;

export const emptyStack: UndoStack = { past: [], future: [] };

/** A new action: it becomes the next thing to undo and discards anything that could have been redone. */
export function pushEntry(stack: UndoStack, entry: UndoEntry): UndoStack {
  return { past: [...stack.past, entry].slice(-UNDO_LIMIT), future: [] };
}

export function peekUndo(stack: UndoStack): UndoEntry | null {
  return stack.past[stack.past.length - 1] ?? null;
}

export function peekRedo(stack: UndoStack): UndoEntry | null {
  return stack.future[stack.future.length - 1] ?? null;
}

/** `entry` was undone: it leaves the undo side, wherever it sat, and becomes the next redo. */
export function markUndone(stack: UndoStack, entry: UndoEntry): UndoStack {
  if (!stack.past.includes(entry)) return stack;
  return { past: stack.past.filter((e) => e !== entry), future: [...stack.future, entry] };
}

/** `entry` was redone: it returns to the undo side; the rest of the redo side stays. */
export function markRedone(stack: UndoStack, entry: UndoEntry): UndoStack {
  if (!stack.future.includes(entry)) return stack;
  return { past: [...stack.past, entry].slice(-UNDO_LIMIT), future: stack.future.filter((e) => e !== entry) };
}

export function stackView(stack: UndoStack) {
  return { canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}
