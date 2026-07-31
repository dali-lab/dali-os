// Client-safe helpers over BlockNote block JSON. Successor of the legacy
// isEmptyDoc (app/components/editor/shared.tsx) for surfaces whose loaders
// normalize content to block arrays via ensureBlocks. Pure — safe to import
// from components, routes, and server code alike.

import { blocksToPlainText } from "~/components/doc/schema/configs";

// Block types that count as content even when they carry no text.
const VISUAL_BLOCK_TYPES = new Set(["image", "table", "divider"]);

interface AnyBlock {
  type?: string;
  children?: AnyBlock[];
}

function hasVisualBlock(blocks: AnyBlock[]): boolean {
  return blocks.some(
    (b) =>
      (typeof b?.type === "string" && VISUAL_BLOCK_TYPES.has(b.type)) ||
      hasVisualBlock(b?.children ?? []),
  );
}

/**
 * True when a block tree renders as nothing: null/undefined, an empty array,
 * or blocks with no text and no visual (image/table/divider) content.
 * Non-array input (e.g. a legacy ProseMirror doc that skipped loader
 * normalization) is treated as empty — DocEditor would render it empty too.
 */
export function isEmptyBlocks(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  if (blocksToPlainText(value).trim() !== "") return false;
  return !hasVisualBlock(value as AnyBlock[]);
}
