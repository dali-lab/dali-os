export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type EditorKey = { key: string; shiftKey: boolean };

const INDENT = "  ";

function lineStart(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

/**
 * The edit a key press makes in the code editor, or null to let the textarea
 * handle it. Tab indents (every selected line when the selection spans lines),
 * Shift+Tab outdents, Enter carries the current line's indentation.
 */
export function applyEditorKey(state: TextEdit, e: EditorKey): TextEdit | null {
  const { value, selectionStart: start, selectionEnd: end } = state;

  if (e.key === "Enter" && !e.shiftKey) {
    const from = lineStart(value, start);
    const indent = /^[ \t]*/.exec(value.slice(from, start))?.[0] ?? "";
    const insert = `\n${indent}`;
    const pos = start + insert.length;
    return { value: value.slice(0, start) + insert + value.slice(end), selectionStart: pos, selectionEnd: pos };
  }

  if (e.key !== "Tab") return null;

  const multiLine = value.slice(start, end).includes("\n");
  if (!e.shiftKey && !multiLine) {
    const pos = start + INDENT.length;
    return { value: value.slice(0, start) + INDENT + value.slice(end), selectionStart: pos, selectionEnd: pos };
  }

  const blockStart = lineStart(value, start);
  // A selection ending right after a newline doesn't include the next line.
  const lastPos = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", lastPos);
  const blockEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  let firstDelta = 0;
  let totalDelta = 0;
  const next = lines.map((line, i) => {
    if (!e.shiftKey) {
      if (i === 0) firstDelta = INDENT.length;
      totalDelta += INDENT.length;
      return INDENT + line;
    }
    const removed = /^ {1,2}|^\t/.exec(line)?.[0].length ?? 0;
    if (i === 0) firstDelta = -removed;
    totalDelta -= removed;
    return line.slice(removed);
  });
  const joined = next.join("\n");
  const newValue = value.slice(0, blockStart) + joined + value.slice(blockEnd);
  const selectionStart = Math.max(blockStart, start + firstDelta);
  const selectionEnd = start === end ? selectionStart : Math.max(selectionStart, end + totalDelta);
  return { value: newValue, selectionStart, selectionEnd };
}
