// Shared types and apply helpers for the AI panel flow.
// Extracted here so AiSlashMenuItems, AiFormattingToolbar, and AiPanel can all
// import from this module without circular dependencies.
//
// Collaborator-race guard: replaceBlocks/insertBlocks are wrapped in try/catch
// because a collaborator may have deleted or restructured the scope blocks while
// the AI request was in flight. On exception we fall back to inserting at the
// current cursor with a toast.info; if that also throws we toast.error and give up.

import type { AiDocAction } from "~/routes/api.ai.doc";
import type { DocEditorInstance, DocPartialBlock } from "../schema/build";

// ── AI session config ─────────────────────────────────────────────────────────
//
// Captured at slash/toolbar click time (before the panel opens) so cursor
// position and selection ids are locked in even if the user's cursor moves.

export interface AiSessionConfig {
  action: AiDocAction;
  origin: "slash" | "toolbar";
  /** Captured at slash-item click time (cursor may move after dialog opens). */
  cursorBlockId: string | null;
  /** Captured at toolbar-item click time (selection is lost once dialog opens). */
  selectionBlockIds: string[] | null;
  /** Whether the cursor block was empty at invoke time (drives default scope). */
  cursorBlockWasEmpty: boolean;
}

/**
 * The structured result handed from runAiAction to the preview layer instead
 * of being applied immediately.
 */
export interface AiPendingResult {
  mode: "replace" | "insert";
  /** Block ids that will be replaced (mode="replace") or used to confirm the
   * scope still exists (mode="insert"). */
  scopeBlockIds: string[];
  /** Block to insert after for mode="insert". Null only when the document was
   * empty at request time (edge case). */
  afterBlockId: string | null;
  actionLabel: string;
  scopeLabel: string;
  /** Raw markdown returned by the AI. Preview dialog parses this. */
  markdown: string;
}

/** Derive a short plain-text excerpt (~100 chars) from a block's content array.
 * Nested children travel with their parent top-level block; their text is NOT
 * included in the excerpt (the excerpt is for the row label only). */
export function blockExcerpt(block: DocPartialBlock, maxLen = 100): string {
  const content = block.content;
  if (!content || typeof content === "string") return "";
  if (!Array.isArray(content)) {
    // Table or other complex content — use the block type as label.
    return `[${block.type ?? "block"}]`;
  }
  let text = "";
  for (const node of content as { type: string; text?: string }[]) {
    if (node.type === "text" && node.text) text += node.text;
    if (text.length >= maxLen) break;
  }
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

/** Filter a block array down to only the checked subset (by index). Top-level
 * children are kept together with their parent block. */
export function filterCheckedBlocks(
  blocks: DocPartialBlock[],
  checkedIndices: Set<number>,
): DocPartialBlock[] {
  return blocks.filter((_, i) => checkedIndices.has(i));
}

/**
 * Apply checked blocks to the document using the pending result's mode.
 * Returns true on success, false on total failure (caller toasts).
 *
 * Race guard: try the primary operation; on throw, fall back to cursor insert
 * with a toast.info; on second throw, toast.error and return false.
 */
export async function applyAiResult(opts: {
  editor: DocEditorInstance;
  result: AiPendingResult;
  blocks: DocPartialBlock[];
  toastInfo: (msg: string) => void;
  toastError: (msg: string) => void;
}): Promise<boolean> {
  const { editor, result, blocks, toastInfo, toastError } = opts;
  if (!blocks.length) return false;

  const primary = () => {
    if (result.mode === "replace") {
      editor.replaceBlocks(result.scopeBlockIds, blocks);
    } else {
      if (result.afterBlockId) {
        editor.insertBlocks(blocks, { id: result.afterBlockId }, "after");
      } else {
        // Fallback when afterBlockId is null (was empty doc at request time).
        const last = editor.document[editor.document.length - 1];
        if (last) {
          editor.insertBlocks(blocks, last, "after");
        } else {
          editor.replaceBlocks(editor.document.map((b) => b.id), blocks);
        }
      }
    }
  };

  try {
    primary();
    return true;
  } catch {
    // Collaborator-race: scope blocks were removed/modified mid-request.
    // Insert at cursor instead so the AI output isn't lost.
    try {
      const cursor = editor.getTextCursorPosition().block;
      editor.insertBlocks(blocks, cursor, "after");
      toastInfo(
        "AI result inserted at cursor — original blocks were modified by a collaborator.",
      );
      return true;
    } catch {
      toastError("AI result could not be applied. Please try again.");
      return false;
    }
  }
}
