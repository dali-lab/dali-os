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

const EDITING_SURFACE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .bn-editor, .ProseMirror';

function isEditingSurface(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => Element | null } | null;
  return typeof el?.closest === "function" && el.closest(EDITING_SURFACE) !== null;
}

/**
 * What a keydown means for the Drive's history: Cmd or Ctrl+Z undoes, plus
 * Shift (or Ctrl+Y) redoes. Null when the key is anything else, or when the
 * user is typing somewhere (the text field's own undo owns the shortcut) or a
 * dialog is open over the Drive.
 */
export function undoKeyIntent(e: KeyEventLike, opts: { dialogOpen?: boolean } = {}): UndoKeyIntent | null {
  if (e.defaultPrevented || e.isComposing || e.altKey || opts.dialogOpen) return null;
  if (isEditingSurface(e.target)) return null;
  const key = e.key.toLowerCase();
  if (key === "y") return e.ctrlKey && !e.metaKey && !e.shiftKey ? "redo" : null;
  if (key !== "z" || !(e.metaKey || e.ctrlKey)) return null;
  return e.shiftKey ? "redo" : "undo";
}

export const OPEN_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';
