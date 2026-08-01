// AI slash-menu items for the BlockNote editor.
//
// A single "Ask AI" item in the slash menu opens AiBar in slash/cursor mode.
// Context-extraction helpers are also exported for use by AiBar.

import React from "react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { DocEditorInstance } from "../schema/build";
import type { AiBarConfig } from "./AiBar";

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

// Checks whether the current cursor block is empty (no content or only whitespace).
export function isCursorBlockEmpty(editor: DocEditorInstance): boolean {
  const block = editor.getTextCursorPosition().block;
  if (!Array.isArray(block.content)) return true;
  return (block.content as { type: string; text?: string }[]).every(
    (c) => c.type !== "text" || !c.text?.trim(),
  );
}

// ── Icon ──────────────────────────────────────────────────────────────────────

function AiIcon() {
  return (
    <span style={{ fontSize: 16, lineHeight: 1, userSelect: "none" }} aria-hidden>
      ✦
    </span>
  );
}

// ── Hook: provides the single AI item for SuggestionMenuController ────────────

export function useAiSlashMenuItems(
  editor: DocEditorInstance,
  aiEnabled: boolean,
  openSession: (config: AiBarConfig) => void,
): DefaultReactSuggestionItem[] | null {
  if (!aiEnabled) return null;

  const askItem: KeyedItem = {
    key: "ai-ask",
    title: "Ask AI",
    subtext: "Open the AI writing assistant",
    aliases: ["ai", "ask", "gpt", "write"],
    group: AI_GROUP,
    icon: <AiIcon />,
    onItemClick: () => {
      // Capture cursor state synchronously before the menu closes.
      const cursorBlock = editor.getTextCursorPosition().block;
      openSession({
        origin: "slash",
        cursorBlockId: cursorBlock.id,
        selectionBlockIds: null,
      });
    },
  };

  return [askItem] as DefaultReactSuggestionItem[];
}
