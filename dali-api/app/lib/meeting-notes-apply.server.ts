// Server-side replay of applyEnhancePlan's ops against DocBlock JSON — the
// MCP `enhance_meeting_notes` apply path's counterpart to renderEnhanceOps
// (app/components/doc/enhance-render.ts), which replays the same ops against
// a live BlockNote editor instance the browser has and the server doesn't.
// Top-level only, matching EnhancePlan's own granularity (every op targets or
// inserts a top-level block); a block's children carry through untouched.
//
// NEVER log block/transcript text.

import { randomUUID } from "node:crypto";
import type { DocBlock, DocInline } from "~/collab/blocknote-server";
import { buildInlineContent, toPartialBlock } from "~/components/doc/enhance-render";
import { blockOwnText } from "~/components/doc/schema/configs";
import type { EditorOp } from "~/components/meeting-recorder/enhance-plan";

/** Applies applyEnhancePlan's ops to a full DocBlock[] tree (top-level array;
 *  each block's own children carry through untouched), returning the new
 *  tree to hand to replaceCollabDocContent. */
export function applyEnhanceOpsToDocBlocks(
  ops: EditorOp[],
  blocks: DocBlock[],
  ctx: { pageId: string; recordingId: string },
): DocBlock[] {
  let result = blocks;

  for (const op of ops) {
    if (op.kind === "update") {
      const content = buildInlineContent(op.text, op.cites, ctx.pageId, ctx.recordingId);
      result = result.map((b) =>
        b.id === op.id ? { ...b, content: content as unknown as DocInline[] } : b,
      );
      continue;
    }
    if (op.kind === "remove") {
      result = result.filter((b) => b.id !== op.id);
      continue;
    }
    // op.kind === "insertAfter"
    const newBlocks: DocBlock[] = op.blocks.map((b) => {
      const partial = toPartialBlock(b, ctx.pageId, ctx.recordingId) as unknown as Partial<DocBlock>;
      return {
        id: randomUUID(),
        type: partial.type ?? "paragraph",
        props: partial.props ?? {},
        content: partial.content,
        children: [],
      };
    });
    if (!newBlocks.length) continue;
    if (op.afterId === null) {
      result = [...newBlocks, ...result];
      continue;
    }
    const idx = result.findIndex((b) => b.id === op.afterId);
    result = idx === -1 ? [...result, ...newBlocks] : [...result.slice(0, idx + 1), ...newBlocks, ...result.slice(idx + 1)];
  }

  return result;
}

/** The collapsed "### Transcript" toggle both Insert transcript and Enhance
 *  apply append — mirrors transcriptToggleBlock in documents.$pageId.tsx (the
 *  client, PartialBlock form) for the server's DocBlock form. */
function transcriptToggleDocBlock(paragraphs: string[]): DocBlock {
  return {
    id: randomUUID(),
    type: "heading",
    props: { level: 3, isToggleable: true },
    content: [{ type: "text", text: "Transcript", styles: {} }],
    children: paragraphs.map((text) => ({
      id: randomUUID(),
      type: "paragraph",
      props: {},
      content: [{ type: "text", text, styles: {} }],
      children: [],
    })),
  };
}

export function hasTranscriptToggle(blocks: DocBlock[]): boolean {
  return blocks.some(
    (b) =>
      b.type === "heading" &&
      Boolean((b.props as { isToggleable?: boolean } | undefined)?.isToggleable) &&
      blockOwnText(b) === "Transcript",
  );
}

/** Appends the transcript toggle if one isn't already there, same
 *  de-duplication rule as the client's Apply/Insert paths. No-op when there's
 *  no transcript to insert. */
export function ensureTranscriptToggle(blocks: DocBlock[], paragraphs: string[]): DocBlock[] {
  if (!paragraphs.length || hasTranscriptToggle(blocks)) return blocks;
  return [...blocks, transcriptToggleDocBlock(paragraphs)];
}
