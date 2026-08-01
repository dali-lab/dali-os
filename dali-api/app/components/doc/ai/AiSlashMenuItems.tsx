// AI slash-menu items for the BlockNote editor, modelled on Notion's AI block.
//
// Group "AI" is inserted first in the slash menu so it appears above the
// default "Basic blocks" group — matching Notion's convention that AI is the
// top-level affordance.
//
// Context cap: we send at most the last 4000 chars of the editor markdown
// to keep prompts bounded. Notion uses a similar windowing approach.
//
// Slash-menu items (no selection survives "/"):
//   "continue"   → cursor-context (blocks up to cursor), insert AFTER cursor block
//   "improve"    → scope chooser (block | document), REPLACE in place
//   "fix"        → scope chooser (block | document), REPLACE in place
//   "summarize"  → scope chooser (block | document), insert after scope (never destroys)
//   "ask"        → prompt → scope chooser → insert after cursor block
//
// Selection toolbar items (selection survives):
//   "improve" / "fix"   → replaceBlocks(selection, newBlocks) — one undo step
//   "summarize"         → insert after last selected block
//   "ask"               → prompt → replaceBlocks(selection, newBlocks)
//
// Loading state: insert a placeholder "✦ Thinking…" paragraph immediately
// AFTER the scope (never touching scope content before a successful response).
// On success: remove placeholder + replaceBlocks / insertBlocks.
// On failure: remove placeholder, toast error, content untouched.
//
// Collaborator-race guard: replaceBlocks/insertBlocks wrapped in try/catch.
// On exception we fall back to inserting the result at the cursor with a toast
// warning rather than silently losing the AI output.

import React from "react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { useToast } from "~/components/ui/toast";
import type { DocEditorInstance } from "../schema/build";
import type { AiDocAction } from "~/routes/api.ai.doc";

// DefaultReactSuggestionItem's type omits `key` but runtime objects carry it —
// same pattern as slash-menu.tsx.
type KeyedItem = DefaultReactSuggestionItem & { key?: string };

// ── AI group label ────────────────────────────────────────────────────────────

const AI_GROUP = "AI";

// ── Context extraction ────────────────────────────────────────────────────────

export const CONTEXT_CHAR_CAP = 4000;

/**
 * Build context markdown from a specific block list.
 * Exported for unit testing.
 */
export function capMarkdown(full: string, cap = CONTEXT_CHAR_CAP): string {
  return full.length > cap ? full.slice(full.length - cap) : full;
}

/**
 * Context for "Continue writing": all blocks from doc start through the
 * current cursor block (inclusive), tail-capped at CONTEXT_CHAR_CAP.
 * This ensures the model sees the most-recent content leading up to the cursor.
 */
async function getContinueContext(editor: DocEditorInstance): Promise<string> {
  const cursorBlockId = editor.getTextCursorPosition().block.id;
  const allBlocks = editor.document;

  // Slice from start up to and including the cursor block.
  const idx = allBlocks.findIndex((b) => b.id === cursorBlockId);
  const contextBlocks = idx >= 0 ? allBlocks.slice(0, idx + 1) : allBlocks;

  const full = editor.blocksToMarkdownLossy(
    contextBlocks as Parameters<typeof editor.blocksToMarkdownLossy>[0],
  );
  return capMarkdown(full);
}

/**
 * Context for scope=block: the current cursor block's markdown.
 * Returns { markdown, blockIds } where blockIds is [cursorBlockId].
 */
async function getBlockScopeContext(
  editor: DocEditorInstance,
): Promise<{ markdown: string; blockIds: string[] }> {
  const cursorBlock = editor.getTextCursorPosition().block;
  const full = editor.blocksToMarkdownLossy(
    [cursorBlock] as Parameters<typeof editor.blocksToMarkdownLossy>[0],
  );
  return { markdown: capMarkdown(full), blockIds: [cursorBlock.id] };
}

/**
 * Context for scope=document: the entire document markdown.
 */
async function getDocumentScopeContext(
  editor: DocEditorInstance,
): Promise<{ markdown: string; blockIds: string[] }> {
  const full = editor.blocksToMarkdownLossy(
    editor.document as Parameters<typeof editor.blocksToMarkdownLossy>[0],
  );
  return {
    markdown: capMarkdown(full),
    blockIds: editor.document.map((b) => b.id),
  };
}

/**
 * Context for selection: the selected blocks' markdown.
 * Returns blockIds = [] when there is no selection (caller should fall back).
 */
export async function getSelectionContext(
  editor: DocEditorInstance,
): Promise<{ markdown: string; blockIds: string[] }> {
  const sel = editor.getSelection();
  if (!sel?.blocks?.length) return { markdown: "", blockIds: [] };
  const full = editor.blocksToMarkdownLossy(
    sel.blocks as Parameters<typeof editor.blocksToMarkdownLossy>[0],
  );
  return { markdown: capMarkdown(full), blockIds: sel.blocks.map((b) => b.id) };
}

// ── Placeholder block helpers ─────────────────────────────────────────────────

const PLACEHOLDER_CONTENT = "✦ Thinking…";

/**
 * Insert a placeholder paragraph AFTER a reference block and return its id.
 * The reference block is always outside the scope being rewritten, so we never
 * touch scope content before a successful AI response.
 */
function insertPlaceholderAfter(
  editor: DocEditorInstance,
  afterBlock: { id: string },
): string {
  const inserted = editor.insertBlocks(
    [{ type: "paragraph", content: PLACEHOLDER_CONTENT }],
    afterBlock,
    "after",
  );
  return inserted[0].id;
}

function removePlaceholder(editor: DocEditorInstance, placeholderId: string) {
  try {
    editor.removeBlocks([placeholderId]);
  } catch {
    // Block may already be gone (e.g. collab peer removed it). Ignore.
  }
}

// ── Core AI request ───────────────────────────────────────────────────────────

async function callAi(opts: {
  action: AiDocAction;
  instruction?: string;
  context: string;
}): Promise<string> {
  const res = await fetch("/api/ai/doc", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if ((body as { aiEnabled?: false }).aiEnabled === false) {
      throw new Error("AI is not configured on this server.");
    }
    throw new Error("AI request failed. Please try again.");
  }

  const data = (await res.json()) as { markdown?: string };
  if (!data.markdown) throw new Error("Empty response from AI.");
  return data.markdown;
}

// ── Scope types ───────────────────────────────────────────────────────────────

export type AiScope = "block" | "document";

// ── Core run-action helper (shared by slash menu and toolbar) ─────────────────

/**
 * Run an AI action with explicit scope/context information.
 *
 * For REPLACE actions (improve, fix): replaceBlocks(scopeBlockIds, newBlocks).
 * For INSERT actions (continue, summarize, prompt): insert after afterBlock.
 * Collaborator-race guard: if replaceBlocks/insertBlocks throws, we fall back
 * to inserting at the current cursor and toast a warning.
 */
export async function runAiAction(opts: {
  editor: DocEditorInstance;
  action: AiDocAction;
  instruction?: string;
  context: string;
  // Block ids that define the scope. For REPLACE actions these are replaced.
  // For INSERT actions they identify the "end" block to insert after.
  scopeBlockIds: string[];
  // The block immediately AFTER which we insert the placeholder / result
  // (always a block OUTSIDE the scope so we don't touch scope content early).
  afterBlock: { id: string };
  toastError: (msg: string) => void;
  toastWarn?: (msg: string) => void;
}) {
  const {
    editor,
    action,
    instruction,
    context,
    scopeBlockIds,
    afterBlock,
    toastError,
    toastWarn,
  } = opts;

  const placeholderId = insertPlaceholderAfter(editor, afterBlock);

  try {
    const markdown = await callAi({ action, instruction, context });
    const newBlocks = await editor.tryParseMarkdownToBlocks(markdown);
    if (!newBlocks.length) {
      removePlaceholder(editor, placeholderId);
      return;
    }

    // Determine whether this is a replace-in-place action.
    const isReplace =
      (action === "improve" || action === "fix") && scopeBlockIds.length > 0;
    // Summarize with scope replaces nothing — it always inserts after scope.
    // Ask AI (prompt) in selection mode replaces the selection (Notion behavior).
    const isSelectionAsk =
      action === "prompt" && scopeBlockIds.length > 0;

    try {
      if (isReplace || isSelectionAsk) {
        // Replace scope content, then remove the placeholder that was
        // inserted after the scope.
        editor.replaceBlocks(scopeBlockIds, newBlocks);
        removePlaceholder(editor, placeholderId);
      } else {
        // Insert: replace the placeholder with the result blocks.
        editor.replaceBlocks([placeholderId], newBlocks);
      }
    } catch {
      // Collaborator-race: scope blocks were deleted/changed mid-request.
      // Fall back to inserting the result at the cursor rather than losing it.
      removePlaceholder(editor, placeholderId);
      try {
        const cursor = editor.getTextCursorPosition().block;
        editor.insertBlocks(newBlocks, cursor, "after");
        toastWarn?.(
          "AI result inserted at cursor — original blocks were modified by a collaborator.",
        );
      } catch {
        // Total failure — just toast.
        toastError("AI result could not be applied. Please try again.");
      }
    }
  } catch (err) {
    removePlaceholder(editor, placeholderId);
    toastError(err instanceof Error ? err.message : "AI request failed.");
  }
}

// ── Scope chooser via dialog.choice ──────────────────────────────────────────
//
// dialog.choice resolves null on cancel/dismiss — Escape ABORTS the AI action
// instead of being coerced into a scope (a full-document rewrite on an escape
// keypress would be a nasty surprise).
// Returns: "block" | "document" | null (null = aborted).

export async function chooseScopeDialog(
  dialogChoice: (opts: {
    title: string;
    description?: React.ReactNode;
    options: { value: string; label: string; description?: string }[];
    cancelLabel?: string;
  }) => Promise<string | null>,
  currentBlockIsEmpty: boolean,
): Promise<AiScope | null> {
  if (currentBlockIsEmpty) {
    // Empty block: "Current block" would produce empty context. Default to document.
    return "document";
  }
  const picked = await dialogChoice({
    title: "Apply to…",
    description: "Choose the scope for this AI action.",
    options: [
      { value: "block", label: "Current block", description: "Only the block the cursor is in." },
      { value: "document", label: "Entire document", description: "The whole page body." },
    ],
  });
  if (picked !== "block" && picked !== "document") return null;
  return picked;
}

// Checks whether the current cursor block is empty (no content or only whitespace).
function isCursorBlockEmpty(editor: DocEditorInstance): boolean {
  const block = editor.getTextCursorPosition().block;
  if (!Array.isArray(block.content)) return true;
  return (block.content as { type: string; text?: string }[]).every(
    (c) => c.type !== "text" || !c.text?.trim(),
  );
}

// ── Slash menu: scoped action entry points ────────────────────────────────────

/** Build the "after block" reference for slash-menu context: the cursor block.
 * The placeholder is inserted after this block so scope content is untouched. */
function getSlashMenuAfterBlock(editor: DocEditorInstance) {
  return editor.getTextCursorPosition().block;
}

// ── "Ask AI…" inline prompt form ──────────────────────────────────────────────

export function useAskAiPrompt(editor: DocEditorInstance) {
  const toast = useToast();

  return async (
    dialogPrompt: (opts: {
      title: string;
      label?: string;
      placeholder?: string;
    }) => Promise<string | null>,
    dialogChoice: (opts: {
      title: string;
      description?: React.ReactNode;
      options: { value: string; label: string; description?: string }[];
      cancelLabel?: string;
    }) => Promise<string | null>,
  ) => {
    const instruction = await dialogPrompt({
      title: "Ask AI",
      label: "What would you like AI to write or do?",
      placeholder: "e.g. Write a project summary, list key risks…",
    });
    if (!instruction) return;

    const isEmpty = isCursorBlockEmpty(editor);
    const scope = await chooseScopeDialog(dialogChoice, isEmpty);
    if (scope === null) return;

    const afterBlock = getSlashMenuAfterBlock(editor);
    const { markdown: context, blockIds: scopeBlockIds } =
      scope === "block"
        ? await getBlockScopeContext(editor)
        : await getDocumentScopeContext(editor);

    await runAiAction({
      editor,
      action: "prompt",
      instruction,
      context,
      scopeBlockIds,
      afterBlock,
      toastError: (m) => toast.error(m),
      toastWarn: (m) => toast.info(m),
    });
  };
}

// ── Icon ──────────────────────────────────────────────────────────────────────

function AiIcon() {
  return (
    <span style={{ fontSize: 16, lineHeight: 1, userSelect: "none" }} aria-hidden>
      ✦
    </span>
  );
}

// ── Slash menu items factory ──────────────────────────────────────────────────

export function buildAiSlashMenuItems(
  editor: DocEditorInstance,
  dialogPrompt: (opts: {
    title: string;
    label?: string;
    placeholder?: string;
  }) => Promise<string | null>,
  dialogChoice: (opts: {
    title: string;
    description?: React.ReactNode;
    options: { value: string; label: string; description?: string }[];
    cancelLabel?: string;
  }) => Promise<string | null>,
  toastError: (msg: string) => void,
  toastWarn: (msg: string) => void,
): DefaultReactSuggestionItem[] {
  // ── Continue writing ──────────────────────────────────────────────────────
  // Context = doc start → cursor block (tail-capped). Result inserted AFTER the
  // cursor block. No scope chooser — "continue" only makes sense from cursor.
  const continueItem: KeyedItem = {
    key: "ai-continue",
    title: "Continue writing",
    subtext: "AI continues from where you left off",
    aliases: ["continue", "ai continue"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      void (async () => {
        const afterBlock = getSlashMenuAfterBlock(editor);
        const context = await getContinueContext(editor);
        await runAiAction({
          editor,
          action: "continue",
          context,
          scopeBlockIds: [],
          afterBlock,
          toastError,
          toastWarn,
        });
      })();
    },
  };

  // ── Improve writing ───────────────────────────────────────────────────────
  // Scope chooser → REPLACE scope in place.
  const improveItem: KeyedItem = {
    key: "ai-improve",
    title: "Improve writing",
    subtext: "AI rewrites the current block or document for clarity",
    aliases: ["improve", "rewrite", "enhance"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      void (async () => {
        const isEmpty = isCursorBlockEmpty(editor);
        const scope = await chooseScopeDialog(dialogChoice, isEmpty);
        if (scope === null) return;

        const afterBlock = getSlashMenuAfterBlock(editor);
        const { markdown: context, blockIds: scopeBlockIds } =
          scope === "block"
            ? await getBlockScopeContext(editor)
            : await getDocumentScopeContext(editor);

        await runAiAction({
          editor,
          action: "improve",
          context,
          scopeBlockIds,
          afterBlock,
          toastError,
          toastWarn,
        });
      })();
    },
  };

  // ── Fix spelling & grammar ────────────────────────────────────────────────
  // Scope chooser → REPLACE scope in place.
  const fixItem: KeyedItem = {
    key: "ai-fix",
    title: "Fix spelling & grammar",
    subtext: "AI corrects spelling and grammar in the current block or document",
    aliases: ["fix", "spell", "grammar", "proofread"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      void (async () => {
        const isEmpty = isCursorBlockEmpty(editor);
        const scope = await chooseScopeDialog(dialogChoice, isEmpty);
        if (scope === null) return;

        const afterBlock = getSlashMenuAfterBlock(editor);
        const { markdown: context, blockIds: scopeBlockIds } =
          scope === "block"
            ? await getBlockScopeContext(editor)
            : await getDocumentScopeContext(editor);

        await runAiAction({
          editor,
          action: "fix",
          context,
          scopeBlockIds,
          afterBlock,
          toastError,
          toastWarn,
        });
      })();
    },
  };

  // ── Summarize ─────────────────────────────────────────────────────────────
  // Scope chooser → insert AFTER scope (never destroys content).
  const summarizeItem: KeyedItem = {
    key: "ai-summarize",
    title: "Summarize",
    subtext: "AI writes a summary of the current block or document",
    aliases: ["summarize", "summary", "tldr"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      void (async () => {
        const isEmpty = isCursorBlockEmpty(editor);
        const scope = await chooseScopeDialog(dialogChoice, isEmpty);
        if (scope === null) return;

        const afterBlock = getSlashMenuAfterBlock(editor);
        const { markdown: context, blockIds: scopeBlockIds } =
          scope === "block"
            ? await getBlockScopeContext(editor)
            : await getDocumentScopeContext(editor);

        // Summarize never replaces — pass empty scopeBlockIds so runAiAction
        // uses the insert-after path for both scopes.
        await runAiAction({
          editor,
          action: "summarize",
          context,
          scopeBlockIds: [],
          afterBlock:
            scope === "document"
              ? // Insert at end of document: after the last block.
                editor.document[editor.document.length - 1] ?? afterBlock
              : afterBlock,
          toastError,
          toastWarn,
        });
        void scopeBlockIds; // consumed only for context, not for replacement
      })();
    },
  };

  // ── Ask AI… ───────────────────────────────────────────────────────────────
  // Prompt → scope chooser → insert after cursor block (context only, not replaced,
  // unless Ask AI is in selection-toolbar mode — which uses runAiAction directly).
  const askItem: KeyedItem = {
    key: "ai-ask",
    title: "Ask AI…",
    subtext: "Open a prompt for a custom AI request",
    aliases: ["ai", "ask", "gpt", "write"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      void (async () => {
        const instruction = await dialogPrompt({
          title: "Ask AI",
          label: "What would you like AI to write or do?",
          placeholder: "e.g. Write a project summary, list key risks…",
        });
        if (!instruction) return;

        const isEmpty = isCursorBlockEmpty(editor);
        const scope = await chooseScopeDialog(dialogChoice, isEmpty);
        if (scope === null) return;

        const afterBlock = getSlashMenuAfterBlock(editor);
        const { markdown: context } =
          scope === "block"
            ? await getBlockScopeContext(editor)
            : await getDocumentScopeContext(editor);

        // Slash-menu Ask AI inserts after cursor; never replaces (scopeBlockIds=[]).
        await runAiAction({
          editor,
          action: "prompt",
          instruction,
          context,
          scopeBlockIds: [],
          afterBlock,
          toastError,
          toastWarn,
        });
      })();
    },
  };

  return [askItem, continueItem, summarizeItem, improveItem, fixItem] as DefaultReactSuggestionItem[];
}

// ── Hook: provides items for SuggestionMenuController ────────────────────────

export function useAiSlashMenuItems(
  editor: DocEditorInstance,
  aiEnabled: boolean,
  dialogPrompt: (opts: {
    title: string;
    label?: string;
    placeholder?: string;
  }) => Promise<string | null>,
  dialogChoice: (opts: {
    title: string;
    description?: React.ReactNode;
    options: { value: string; label: string; description?: string }[];
    cancelLabel?: string;
  }) => Promise<string | null>,
): DefaultReactSuggestionItem[] | null {
  const toast = useToast();

  if (!aiEnabled) return null;

  return buildAiSlashMenuItems(
    editor,
    dialogPrompt,
    dialogChoice,
    (m) => toast.error(m),
    (m) => toast.info(m),
  );
}

