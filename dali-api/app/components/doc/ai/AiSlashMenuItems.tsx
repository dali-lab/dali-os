// AI slash-menu items for the BlockNote editor, modelled on Notion's AI block.
//
// Group "AI" is inserted first in the slash menu so it appears above the
// default "Basic blocks" group — matching Notion's convention that AI is the
// top-level affordance.
//
// Context cap: we send at most the last 4000 chars of the editor markdown
// to keep prompts bounded. Notion uses a similar windowing approach.
//
// Insert strategy mirrors Notion:
//   "continue" / "prompt"  → insert after the current block (new content)
//   "improve" / "fix"      → replace selected blocks if any, else insert at end
//   "summarize" with sel   → replace selected blocks
//   "summarize" without    → insert at document end
//
// Loading state: insert a placeholder "✦ Thinking…" paragraph, replace it on
// success, remove it on error (+ show a toast). This is the lightest approach
// that keeps the doc in a consistent state — no external state machine needed.

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

const CONTEXT_CHAR_CAP = 4000;

/**
 * Export selected blocks as markdown (capped). Falls back to the whole doc.
 * Returns { markdown, selectedBlockIds } so the caller can optionally replace
 * the selection.
 */
async function getContext(
  editor: DocEditorInstance,
  useSelection: boolean,
): Promise<{ markdown: string; selectedBlockIds: string[] }> {
  const sel = editor.getSelection();
  const selectedBlockIds =
    useSelection && sel?.blocks?.length ? sel.blocks.map((b) => b.id) : [];

  const blocks =
    selectedBlockIds.length > 0
      ? sel!.blocks
      : editor.document;

  const full = editor.blocksToMarkdownLossy(blocks as Parameters<typeof editor.blocksToMarkdownLossy>[0]);
  // Cap from the end so we have the most-recent context.
  const markdown =
    full.length > CONTEXT_CHAR_CAP
      ? full.slice(full.length - CONTEXT_CHAR_CAP)
      : full;

  return { markdown, selectedBlockIds };
}

// ── Placeholder block helpers ─────────────────────────────────────────────────

const PLACEHOLDER_CONTENT = "✦ Thinking…";

function insertPlaceholder(editor: DocEditorInstance): string {
  const cursor = editor.getTextCursorPosition();
  const refBlock = cursor.block;
  const inserted = editor.insertBlocks(
    [{ type: "paragraph", content: PLACEHOLDER_CONTENT }],
    refBlock,
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

// ── Insert result into editor ─────────────────────────────────────────────────

async function insertResult(opts: {
  editor: DocEditorInstance;
  action: AiDocAction;
  placeholderId: string;
  selectedBlockIds: string[];
  markdown: string;
}) {
  const { editor, action, placeholderId, selectedBlockIds, markdown } = opts;
  const newBlocks = await editor.tryParseMarkdownToBlocks(markdown);
  if (!newBlocks.length) {
    removePlaceholder(editor, placeholderId);
    return;
  }

  if (
    (action === "improve" || action === "fix" || action === "summarize") &&
    selectedBlockIds.length > 0
  ) {
    // Replace selected blocks, then remove placeholder (which was inserted
    // after the cursor, outside the selection).
    editor.replaceBlocks(selectedBlockIds, newBlocks);
    removePlaceholder(editor, placeholderId);
  } else {
    // Replace the placeholder with the result blocks.
    editor.replaceBlocks([placeholderId], newBlocks);
  }
}

// ── Run-action orchestrator ───────────────────────────────────────────────────

async function runAiAction(opts: {
  editor: DocEditorInstance;
  action: AiDocAction;
  instruction?: string;
  toastError: (msg: string) => void;
  useSelectionForContext: boolean;
}) {
  const { editor, action, instruction, toastError, useSelectionForContext } = opts;

  const { markdown: context, selectedBlockIds } = await getContext(
    editor,
    useSelectionForContext,
  );

  const placeholderId = insertPlaceholder(editor);

  try {
    const result = await callAi({ action, instruction, context });
    await insertResult({ editor, action, placeholderId, selectedBlockIds, markdown: result });
  } catch (err) {
    removePlaceholder(editor, placeholderId);
    toastError(err instanceof Error ? err.message : "AI request failed.");
  }
}

// ── "Ask AI…" inline prompt form ──────────────────────────────────────────────
// Shown as a small modal-style dialog after the menu item is clicked.
// We use dialog.prompt() from the repo's unified popup system so it inherits
// the app's modal chrome (dark mode, focus-trap, etc.) automatically.
// The alternative (a custom inline block) would require a custom BlockNote
// node and would be complex to dismiss properly. The dialog approach matches
// how Notion surfaces its "custom prompt" option in the AI menu.

export function useAskAiPrompt(editor: DocEditorInstance) {
  const toast = useToast();

  return async (dialogPrompt: (opts: { title: string; label?: string; placeholder?: string }) => Promise<string | null>) => {
    const instruction = await dialogPrompt({
      title: "Ask AI",
      label: "What would you like AI to write or do?",
      placeholder: "e.g. Write a project summary, list key risks…",
    });
    if (!instruction) return;

    await runAiAction({
      editor,
      action: "prompt",
      instruction,
      toastError: (m) => toast.error(m),
      useSelectionForContext: false,
    });
  };
}

// ── Slash menu items factory ──────────────────────────────────────────────────

// Icon: a simple ✦ spark — consistent with the placeholder text.
function AiIcon() {
  return (
    <span style={{ fontSize: 16, lineHeight: 1, userSelect: "none" }} aria-hidden>
      ✦
    </span>
  );
}

// Inner component that owns toast + dialog usage (hooks must be called
// unconditionally). We call this through a React render inside getItems (the
// icon field accepts ReactNode — BlockNote renders it inside SuggestionMenu).
// The actual hook calls are in the onItemClick closures, not in render, so
// the hooks are always called at menu-mount time regardless of which item
// is clicked.

// Hooks called at component boundary; closures capture them for onClick.
// This component is never mounted — it exists only to generate the items array
// with live hook values baked in.
export function buildAiSlashMenuItems(
  editor: DocEditorInstance,
  dialogPrompt: (opts: {
    title: string;
    label?: string;
    placeholder?: string;
  }) => Promise<string | null>,
  toastError: (msg: string) => void,
): DefaultReactSuggestionItem[] {
  const makeItem = (
    key: string,
    title: string,
    subtext: string,
    aliases: string[],
    action: AiDocAction,
    useSelectionForContext: boolean,
    onClick?: () => void,
  ): KeyedItem => ({
    key,
    title,
    subtext,
    aliases,
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick:
      onClick ??
      (() => {
        void runAiAction({
          editor,
          action,
          toastError,
          useSelectionForContext,
        });
      }),
  });

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
        await runAiAction({
          editor,
          action: "prompt",
          instruction,
          toastError,
          useSelectionForContext: false,
        });
      })();
    },
  };

  return ([
    askItem,
    makeItem(
      "ai-continue",
      "Continue writing",
      "AI continues from where you left off",
      ["continue", "ai continue"],
      "continue",
      false,
    ),
    makeItem(
      "ai-summarize",
      "Summarize",
      "AI writes a summary of the document or selection",
      ["summarize", "summary", "tldr"],
      "summarize",
      true,
    ),
    makeItem(
      "ai-improve",
      "Improve writing",
      "AI rewrites the selection or document for clarity",
      ["improve", "rewrite", "enhance"],
      "improve",
      true,
    ),
    makeItem(
      "ai-fix",
      "Fix spelling & grammar",
      "AI corrects spelling and grammar errors",
      ["fix", "spell", "grammar", "proofread"],
      "fix",
      true,
    ),
  ] as KeyedItem[]) as DefaultReactSuggestionItem[];
}

// ── Hook: provides items for SuggestionMenuController ────────────────────────
// Called inside DocEditorImpl (already inside a React tree with all providers
// mounted at root level). Returns null when AI is disabled.

export function useAiSlashMenuItems(
  editor: DocEditorInstance,
  aiEnabled: boolean,
  dialogPrompt: (opts: {
    title: string;
    label?: string;
    placeholder?: string;
  }) => Promise<string | null>,
): DefaultReactSuggestionItem[] | null {
  const toast = useToast();
  const toastError = (m: string) => toast.error(m);

  if (!aiEnabled) return null;

  return buildAiSlashMenuItems(editor, dialogPrompt, toastError);
}
