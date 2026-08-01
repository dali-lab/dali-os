/**
 * Pure text-matching utility for the Find & Replace feature.
 *
 * Walks a ProseMirror document node and returns the absolute positions of every
 * case-insensitive substring match of `needle`. Returns an empty array when
 * `needle` is blank. Has zero runtime dependencies — pure node-JS-compatible so
 * it can be unit-tested without a DOM or editor instance.
 */

export interface MatchRange {
  /** Absolute ProseMirror "from" position (inclusive). */
  from: number;
  /** Absolute ProseMirror "to" position (exclusive). */
  to: number;
}

/**
 * Walk a ProseMirror Node tree and collect every case-insensitive substring
 * match of `needle`, returned as absolute {from, to} document positions.
 *
 * This function only examines text nodes — block nodes, marks, and non-text
 * inline content are transparent to the search. Multi-node matches that would
 * span two sibling text runs are NOT detected (ProseMirror text runs inside
 * one block are concatenated by the PM model, so intra-block matches across
 * adjacent text nodes ARE found; inter-block matches spanning block boundaries
 * are intentionally skipped — consistent with Notion/GDocs behavior).
 */
export function findMatchRanges(doc: DocLike, needle: string): MatchRange[] {
  if (!needle) return [];
  const lower = needle.toLowerCase();
  const matches: MatchRange[] = [];

  doc.nodesBetween(0, doc.nodeSize - 2, (node, pos) => {
    if (!node.isText) return; // only text leaves; skip descending into atoms

    const text = node.text ?? "";
    const textLower = text.toLowerCase();
    let offset = 0;

    while (offset <= textLower.length - lower.length) {
      const idx = textLower.indexOf(lower, offset);
      if (idx === -1) break;
      matches.push({ from: pos + idx, to: pos + idx + lower.length });
      offset = idx + 1; // overlapping matches allowed
    }
  });

  return matches;
}

// Minimal structural type so the util can be tested without importing
// prosemirror-model (avoids a DOM dependency in unit tests while still being
// compatible with the real PM Node type which satisfies this interface).
export interface DocLike {
  nodeSize: number;
  nodesBetween(
    from: number,
    to: number,
    f: (node: NodeLike, pos: number) => boolean | void,
    startPos?: number,
  ): void;
}

export interface NodeLike {
  isText: boolean;
  text?: string | null;
  nodeSize: number;
}
