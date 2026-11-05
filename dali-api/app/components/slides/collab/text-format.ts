export type TextFormat = "bold" | "italic" | "underline" | "bullet" | "link";

interface EditorLike {
  document: Array<{ type: string }>;
  focus?: () => void;
  toggleStyles?: (styles: Record<string, boolean>) => void;
  updateBlock?: (block: unknown, update: { type: string }) => void;
  _tiptapEditor?: { commands?: { selectAll?: () => unknown } };
}

const editors = new Map<string, EditorLike>();

export function registerTextEditor(id: string, editor: unknown): () => void {
  editors.set(id, editor as EditorLike);
  return () => {
    if (editors.get(id) === editor) editors.delete(id);
  };
}

/** Applies a format to every word of a text box from outside it. Link only selects the text, so BlockNote's own toolbar offers the link field. */
export function formatWholeText(id: string, format: TextFormat): boolean {
  const editor = editors.get(id);
  if (!editor) return false;
  try {
    editor.focus?.();
    editor._tiptapEditor?.commands?.selectAll?.();
    if (format === "link") return true;
    if (format === "bullet") {
      const allBullets = editor.document.length > 0 && editor.document.every((b) => b.type === "bulletListItem");
      for (const block of editor.document) editor.updateBlock?.(block, { type: allBullets ? "paragraph" : "bulletListItem" });
      return true;
    }
    editor.toggleStyles?.({ [format]: true });
    return true;
  } catch {
    return false;
  }
}

/** Puts the caret where a double click landed inside a contenteditable, or at its end when the point is outside any text. */
export function placeCaretAt(root: HTMLElement, point: { x: number; y: number } | null): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection?.();
  if (!selection) return;
  let range: Range | null = null;
  if (point) {
    const withPos = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const pos = withPos.caretPositionFromPoint?.(point.x, point.y);
    if (pos && root.contains(pos.offsetNode)) {
      range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    } else {
      const r = withPos.caretRangeFromPoint?.(point.x, point.y);
      if (r && root.contains(r.startContainer)) range = r;
    }
  }
  if (!range) {
    range = doc.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
