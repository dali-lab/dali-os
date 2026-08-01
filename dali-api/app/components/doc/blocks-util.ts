// Pure helpers over BlockNote Block JSON — no editor/React imports so they run
// in node (vitest, server loaders) as well as the client chrome.

import { blocksToPlainText } from "./schema/configs";

/**
 * One entry in the document outline, same shape the legacy CollaborativeEditor
 * emitted for the pages ToC. `ordinal` is the heading's 0-based index among all
 * H1–H3 headings; consumers re-resolve it against the live document on click.
 */
export type TocHeading = { level: number; text: string; ordinal: number };

// Structurally typed (like blocksToPlainText in schema/configs.ts) so any
// Block[] — regardless of which feature schema produced it — walks fine.
interface AnyBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
}

/** Word count over the full block tree, legacy-compatible (split on \s+). */
export function countWords(blocks: unknown): number {
  const text = blocksToPlainText(Array.isArray(blocks) ? blocks : null).trim();
  return text ? text.split(/\s+/).length : 0;
}

/** H1–H3 outline in traversal order (nested headings included, like the legacy
 * descendants() walk). Text comes through the shared inline-text logic so
 * mentions render as "@handle". */
export function extractHeadings(blocks: unknown): TocHeading[] {
  const headings: TocHeading[] = [];
  const walk = (block: AnyBlock) => {
    if (block.type === "heading") {
      const level = Number(block.props?.level ?? 1);
      if (level <= 3) {
        headings.push({
          level,
          // Children are sibling blocks visually nested under the heading, not
          // part of its text — strip them before flattening.
          text: blocksToPlainText([{ ...block, children: [] }]),
          ordinal: headings.length,
        });
      }
    }
    for (const child of block.children ?? []) walk(child);
  };
  if (Array.isArray(blocks)) for (const block of blocks as AnyBlock[]) walk(block);
  return headings;
}

/** Legacy TipTap bodies are ProseMirror JSON ({type: "doc", content: [...]}).
 * DocEditor never converts them client-side — server loaders own conversion —
 * but it must not crash if one slips through. */
export function looksLikeProseMirrorDoc(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "doc"
  );
}

/**
 * Defensive coercion of DocEditor's `initialContent` to something BlockNote
 * accepts: a non-empty array of block objects, or undefined (BlockNote throws
 * on `[]`). ProseMirror JSON renders empty with a console.warn — by contract
 * the server loader should have converted it.
 */
export function normalizeInitialContent<T>(input: unknown): T[] | undefined {
  if (input == null) return undefined;
  if (looksLikeProseMirrorDoc(input)) {
    console.warn(
      "[doc] initialContent looks like legacy ProseMirror JSON ({type:\"doc\"}). " +
        "Server loaders are responsible for converting to BlockNote blocks; rendering empty.",
    );
    return undefined;
  }
  if (!Array.isArray(input)) {
    console.warn("[doc] initialContent is not a block array; rendering empty.");
    return undefined;
  }
  if (input.length === 0) return undefined;
  return input as T[];
}

/**
 * Insert a suggestion item adjacent to the other items of its `group`, so menus
 * that render one section header per contiguous group run don't emit the same
 * group twice (the spike's duplicate "Basic blocks" React-key bug). Appends at
 * the end when the group isn't present. Returns a new array.
 */
export function insertItemIntoGroup<T extends { group?: string }>(items: T[], item: T): T[] {
  const out = [...items];
  let lastIdx = -1;
  out.forEach((existing, i) => {
    if (existing.group !== undefined && existing.group === item.group) lastIdx = i;
  });
  if (lastIdx === -1) out.push(item);
  else out.splice(lastIdx + 1, 0, item);
  return out;
}
