// Replays the ops from applyEnhancePlan (meeting-recorder/enhance-plan.ts)
// against a live BlockNoteEditor — the merge logic is pure and editor-free;
// this is the thin adapter that turns its output into real editor calls.
// Sibling to insert.ts on purpose: same "plain types in, editor calls out"
// shape, kept out of meeting-recorder since it's BlockNote-specific.

import { actionItemMatchesBlock, type EditorOp, type EnhanceActionItem, type EnhanceOpBlock } from "~/components/meeting-recorder/enhance-plan";
import type { DocEditorInstance, DocPartialBlock } from "./schema/build";

/** Citation chip href: an ordinary link, not a new inline node (spec §3) —
 *  the transcript panel reads `&at=` to scroll to and highlight the line. */
export function citationHref(pageId: string, recordingId: string, atSeconds: number): string {
  return `/documents/${pageId}?transcript=${encodeURIComponent(recordingId)}&at=${Math.max(0, Math.round(atSeconds))}`;
}

function formatChipLabel(atSeconds: number): string {
  const s = Math.max(0, Math.round(atSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** The block's own text, plus one link chip per cited transcript second.
 *  Exported for the MCP `enhance_meeting_notes` apply path (meeting-notes-
 *  apply.server.ts), which replays the same ops server-side against DocBlock
 *  JSON instead of a live editor — pure function, no editor/React runtime
 *  dependency, safe on the server. */
export function buildInlineContent(
  text: string,
  cites: number[],
  pageId: string,
  recordingId: string,
): DocPartialBlock["content"] {
  const content: Array<{ type: "text"; text: string; styles: object } | { type: "link"; href: string; content: string }> =
    [{ type: "text", text, styles: {} }];
  for (const at of cites) {
    content.push({ type: "text", text: " ", styles: {} });
    content.push({ type: "link", href: citationHref(pageId, recordingId, at), content: formatChipLabel(at) });
  }
  // DocPartialBlock["content"] is schema-typed per block; the shapes above are
  // exactly BlockNote's PartialInlineContent for a block with styled text and
  // the default "link" spec, which every block type in this schema includes.
  return content as unknown as DocPartialBlock["content"];
}

/** Appends a taskMention node (plus a leading space) to a checklist item's
 *  existing content — the "Create tasks" producer's pure half. Pure/
 *  editor-free so it's unit-testable without mounting the doc editor;
 *  documents.$pageId.tsx's onTaskCreated calls this, then editor.updateBlock
 *  with the result. Replaces the plain `/projects/:id?tab=progress&task=:id`
 *  link this used to append (see taskMentionConfig in schema/configs.ts). */
export function appendTaskMentionContent(
  content: DocPartialBlock["content"],
  task: { taskId: string; projectId: string; label: string },
): DocPartialBlock["content"] {
  const next: Array<
    | { type: "text"; text: string; styles: object }
    | { type: "taskMention"; props: { taskId: string; projectId: string; label: string } }
  > = Array.isArray(content) ? [...(content as unknown as typeof next)] : [];
  next.push(
    { type: "text", text: " ", styles: {} },
    {
      type: "taskMention",
      props: { taskId: task.taskId, projectId: task.projectId, label: task.label },
    },
  );
  return next as unknown as DocPartialBlock["content"];
}

/** The action item (if any) a newly-inserted checklist block's text matches
 *  that already has a task — Create tasks run before Apply (specs/meeting-
 *  notes-model.md §4) left no checklist block to backlink the task to, so
 *  Apply links it itself as it inserts the block. */
function taskForChecklistText(text: string, actionItems: EnhanceActionItem[] | undefined): EnhanceActionItem | null {
  if (!actionItems?.length) return null;
  const candidates = actionItems.filter((item) => item.taskId && actionItemMatchesBlock(item.text, text));
  if (candidates.length === 0) return null;
  const exact = candidates.find((item) => item.text.trim().toLowerCase() === text.trim().toLowerCase());
  return exact ?? candidates[0]!;
}

export function toPartialBlock(
  block: EnhanceOpBlock,
  pageId: string,
  recordingId: string,
  ctx: { actionItems?: EnhanceActionItem[]; projectId?: string | null } = {},
): DocPartialBlock {
  const content = buildInlineContent(block.text, block.cites, pageId, recordingId);
  if (block.type === "heading") {
    return { type: "heading", props: { level: 2 }, content } as DocPartialBlock;
  }
  if (block.type === "bulletListItem" || block.type === "bullet") {
    return { type: "bulletListItem", content } as DocPartialBlock;
  }
  // Action item bullets (specs/meeting-notes-model.md §4) — a real checkbox,
  // so Create tasks can find the matching block by text once a task exists.
  if (block.type === "checkListItem") {
    const taskItem = ctx.projectId ? taskForChecklistText(block.text, ctx.actionItems) : null;
    const finalContent = taskItem
      ? appendTaskMentionContent(content, { taskId: taskItem.taskId!, projectId: ctx.projectId!, label: block.text })
      : content;
    return { type: "checkListItem", props: { checked: false }, content: finalContent } as DocPartialBlock;
  }
  return { type: "paragraph", content } as DocPartialBlock;
}

/**
 * Applies applyEnhancePlan's ops to the live editor, one BlockNote call per
 * op, in order. Each call is its own undo step (BlockNote's default); callers
 * that want "Apply" as one undo step should wrap this in editor.transact if
 * the schema exposes it, but the primary undo safety net here is the "Before
 * enhance" named version saved just before this runs.
 */
export function renderEnhanceOps(
  editor: DocEditorInstance,
  ops: EditorOp[],
  ctx: { pageId: string; recordingId: string; actionItems?: EnhanceActionItem[]; projectId?: string | null },
): void {
  for (const op of ops) {
    if (op.kind === "update") {
      const content = buildInlineContent(op.text, op.cites, ctx.pageId, ctx.recordingId);
      editor.updateBlock(op.id, { content } as unknown as DocPartialBlock);
      continue;
    }
    if (op.kind === "remove") {
      editor.removeBlocks([op.id]);
      continue;
    }
    // op.kind === "insertAfter"
    const blocks = op.blocks.map((b) => toPartialBlock(b, ctx.pageId, ctx.recordingId, ctx));
    if (!blocks.length) continue;
    if (op.afterId === null) {
      const doc = editor.document;
      if (doc.length > 0) editor.insertBlocks(blocks, doc[0]!, "before");
      else editor.replaceBlocks(editor.document, blocks);
    } else {
      editor.insertBlocks(blocks, op.afterId, "after");
    }
  }
}
