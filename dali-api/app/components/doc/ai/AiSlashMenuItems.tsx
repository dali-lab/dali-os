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
//   Each item calls openSession({action, origin:"slash", cursorBlockId, ...}).
//   DocView opens AiPanel which owns the entire lifecycle (scope → run → preview → apply).
//
// Selection toolbar items (selection survives):
//   Each item calls openSession({action, origin:"toolbar", selectionBlockIds}).
//   Selection block ids are captured AT CLICK TIME (before the panel opens).
//
// Collaborator-race guard: handled at apply time in apply.ts (applyAiResult).

import React from "react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { DocEditorInstance } from "../schema/build";
import type { AiDocAction } from "~/routes/api.ai.doc";
import type { AiSessionConfig } from "./apply";

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
export async function getContinueContext(editor: DocEditorInstance): Promise<string> {
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
export async function getBlockScopeContext(
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
export async function getDocumentScopeContext(
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

// ── Scope types ───────────────────────────────────────────────────────────────

export type AiScope = "block" | "document";

// Checks whether the current cursor block is empty (no content or only whitespace).
export function isCursorBlockEmpty(editor: DocEditorInstance): boolean {
  const block = editor.getTextCursorPosition().block;
  if (!Array.isArray(block.content)) return true;
  return (block.content as { type: string; text?: string }[]).every(
    (c) => c.type !== "text" || !c.text?.trim(),
  );
}

// ── Action label mapping ──────────────────────────────────────────────────────

export function actionLabel(action: AiDocAction): string {
  switch (action) {
    case "prompt":    return "Ask AI";
    case "continue":  return "Continue writing";
    case "improve":   return "Improve writing";
    case "fix":       return "Fix spelling & grammar";
    case "summarize": return "Summarize";
  }
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
//
// Items are now trivial: they capture cursor state at click time (before the
// slash menu closes and the cursor moves) then call openSession. AiPanel owns
// all subsequent lifecycle (scope UI → fetch → preview → apply).

export function buildAiSlashMenuItems(
  editor: DocEditorInstance,
  openSession: (config: AiSessionConfig) => void,
): DefaultReactSuggestionItem[] {
  function slashSession(action: AiDocAction): KeyedItem["onItemClick"] {
    return () => {
      // Capture cursor state synchronously before the menu closes.
      const cursorBlock = editor.getTextCursorPosition().block;
      const cursorBlockWasEmpty = isCursorBlockEmpty(editor);
      openSession({
        action,
        origin: "slash",
        cursorBlockId: cursorBlock.id,
        selectionBlockIds: null,
        cursorBlockWasEmpty,
      });
    };
  }

  const continueItem: KeyedItem = {
    key: "ai-continue",
    title: "Continue writing",
    subtext: "AI continues from where you left off",
    aliases: ["continue", "ai continue"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: slashSession("continue"),
  };

  const improveItem: KeyedItem = {
    key: "ai-improve",
    title: "Improve writing",
    subtext: "AI rewrites the current block or document for clarity",
    aliases: ["improve", "rewrite", "enhance"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: slashSession("improve"),
  };

  const fixItem: KeyedItem = {
    key: "ai-fix",
    title: "Fix spelling & grammar",
    subtext: "AI corrects spelling and grammar in the current block or document",
    aliases: ["fix", "spell", "grammar", "proofread"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: slashSession("fix"),
  };

  const summarizeItem: KeyedItem = {
    key: "ai-summarize",
    title: "Summarize",
    subtext: "AI writes a summary of the current block or document",
    aliases: ["summarize", "summary", "tldr"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: slashSession("summarize"),
  };

  const askItem: KeyedItem = {
    key: "ai-ask",
    title: "Ask AI…",
    subtext: "Open a prompt for a custom AI request",
    aliases: ["ai", "ask", "gpt", "write"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: slashSession("prompt"),
  };

  return [askItem, continueItem, summarizeItem, improveItem, fixItem] as DefaultReactSuggestionItem[];
}

// ── Hook: provides items for SuggestionMenuController ────────────────────────

export function useAiSlashMenuItems(
  editor: DocEditorInstance,
  aiEnabled: boolean,
  openSession: (config: AiSessionConfig) => void,
): DefaultReactSuggestionItem[] | null {
  if (!aiEnabled) return null;
  return buildAiSlashMenuItems(editor, openSession);
}
