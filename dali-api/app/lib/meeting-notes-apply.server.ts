// Server-side replay of applyEnhancePlan's ops against DocBlock JSON — the
// MCP `enhance_meeting_notes` apply path's counterpart to renderEnhanceOps
// (app/components/doc/enhance-render.ts), which replays the same ops against
// a live BlockNote editor instance the browser has and the server doesn't.
//
// NEVER log block/transcript text.

import { randomUUID } from "node:crypto";
import type { DocBlock, DocInline } from "~/collab/blocknote-server";
import { buildInlineContent, toPartialBlock, type ChipSpeakerAt } from "~/components/doc/enhance-render";
import { blockOwnText } from "~/components/doc/schema/configs";
import {
  markOfProps,
  snapshotTree,
  type EditorOp,
  type EnhanceActionItem,
  type SnapshotBlock,
} from "~/components/meeting-recorder/enhance-plan";

function mapTree(blocks: DocBlock[], fn: (b: DocBlock) => DocBlock[]): DocBlock[] {
  return blocks.flatMap((b) => fn({ ...b, children: mapTree(b.children ?? [], fn) }));
}

/** Applies applyEnhancePlan's ops to a full DocBlock[] tree, returning the
 *  new tree to hand to replaceCollabDocContent. */
export function applyEnhanceOpsToDocBlocks(
  ops: EditorOp[],
  blocks: DocBlock[],
  ctx: {
    pageId: string;
    recordingId: string;
    actionItems?: EnhanceActionItem[];
    projectId?: string | null;
    speakerAt?: ChipSpeakerAt;
  },
): DocBlock[] {
  let result = blocks;

  for (const op of ops) {
    if (op.kind === "update") {
      const content = buildInlineContent(op.text, op.cites, ctx.pageId, ctx.recordingId, ctx.speakerAt);
      result = mapTree(result, (b) => [b.id === op.id ? { ...b, content: content as unknown as DocInline[] } : b]);
      continue;
    }
    if (op.kind === "remove") {
      result = mapTree(result, (b) => (b.id === op.id ? [] : [b]));
      continue;
    }
    const newBlocks: DocBlock[] = op.blocks.map((b) => {
      const partial = toPartialBlock(b, ctx.pageId, ctx.recordingId, ctx) as unknown as Partial<DocBlock>;
      return {
        id: randomUUID(),
        type: partial.type ?? "paragraph",
        props: partial.props ?? {},
        content: partial.content,
        children: [],
      };
    });
    if (!newBlocks.length) continue;
    if (op.kind === "appendChildren") {
      result = mapTree(result, (b) => [b.id === op.parentId ? { ...b, children: [...b.children, ...newBlocks] } : b]);
      continue;
    }
    if (op.afterId === null) {
      result = [...newBlocks, ...result];
      continue;
    }
    const afterId = op.afterId;
    let placed = false;
    result = mapTree(result, (b) => {
      if (b.id !== afterId) return [b];
      placed = true;
      return [b, ...newBlocks];
    });
    if (!placed) result = [...result, ...newBlocks];
  }

  return result;
}

/** The blocks Enhance reads and merges against — the server's counterpart to
 *  enhanceSnapshotBlocks: the tree minus its Transcript toggle. */
export function enhanceSnapshotDocBlocks(blocks: DocBlock[]): SnapshotBlock[] {
  return snapshotTree(blocks.filter((b) => !isTranscriptToggle(b)));
}

export function hasEnhanceMarkInTree(blocks: DocBlock[]): boolean {
  return blocks.some(
    (b) => markOfProps(b.props as Record<string, unknown> | undefined) !== null || hasEnhanceMarkInTree(b.children ?? []),
  );
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

function isTranscriptToggle(b: DocBlock): boolean {
  return (
    b.type === "heading" &&
    Boolean((b.props as { isToggleable?: boolean } | undefined)?.isToggleable) &&
    blockOwnText(b) === "Transcript"
  );
}

export function hasTranscriptToggle(blocks: DocBlock[]): boolean {
  return blocks.some(isTranscriptToggle);
}

/** Appends the transcript toggle if one isn't already there, same
 *  de-duplication rule as the client's Apply/Insert paths. No-op when there's
 *  no transcript to insert. */
export function ensureTranscriptToggle(blocks: DocBlock[], paragraphs: string[]): DocBlock[] {
  if (!paragraphs.length || hasTranscriptToggle(blocks)) return blocks;
  return [...blocks, transcriptToggleDocBlock(paragraphs)];
}
