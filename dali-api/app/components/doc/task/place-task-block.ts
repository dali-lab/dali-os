import type { DocEditorInstance, DocPartialBlock } from "../schema/build";

type TaskProps = { taskId: string; projectId: string; label: string };

function isEmptyParagraph(block: { type: string; content?: unknown }): boolean {
  return block.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;
}

/** Puts a task block where "/task" was typed: on the empty line itself, after
 *  the line if it has text, or at the end if that line has since been deleted.
 *  Returns the caret to the line below so typing carries on. */
export function placeTaskBlock(editor: DocEditorInstance, anchorId: string, task: TaskProps): void {
  const block = { type: "task", props: task } as DocPartialBlock;
  const anchor = editor.getBlock(anchorId);
  const placed =
    anchor && isEmptyParagraph(anchor)
      ? editor.replaceBlocks([anchor], [block]).insertedBlocks
      : editor.insertBlocks([block], anchor ?? editor.document[editor.document.length - 1]!, "after");
  const inserted = placed[0]!;
  const next =
    editor.getNextBlock(inserted) ??
    editor.insertBlocks([{ type: "paragraph" } as DocPartialBlock], inserted, "after")[0]!;
  editor.setTextCursorPosition(next, "start");
  editor.focus();
}

/** Swaps an existing line for a task block, leaving the caret alone. False
 *  when the line is gone. */
export function replaceWithTaskBlock(editor: DocEditorInstance, blockId: string, task: TaskProps): boolean {
  const block = editor.getBlock(blockId);
  if (!block) return false;
  editor.replaceBlocks([block], [{ type: "task", props: task } as DocPartialBlock]);
  return true;
}
