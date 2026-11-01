import { isEditingTarget, modKey } from "~/lib/shortcuts";

export type UndoKeyIntent = "undo" | "redo";

type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  defaultPrevented?: boolean;
  isComposing?: boolean;
};

/**
 * What a keydown means for the Drive's history: Cmd or Ctrl+Z undoes, plus
 * Shift (or Ctrl+Y) redoes. Null when the key is anything else, or when the
 * user is typing somewhere (the text field's own undo owns the shortcut) or a
 * dialog is open over the Drive.
 */
export function undoKeyIntent(e: KeyEventLike, opts: { dialogOpen?: boolean } = {}): UndoKeyIntent | null {
  if (e.defaultPrevented || e.isComposing || e.altKey || opts.dialogOpen) return null;
  if (isEditingTarget(e.target)) return null;
  const key = e.key.toLowerCase();
  if (key === "y") return modKey(e) && !e.metaKey && !e.shiftKey ? "redo" : null;
  if (key !== "z" || !modKey(e)) return null;
  return e.shiftKey ? "redo" : "undo";
}

export const OPEN_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';
