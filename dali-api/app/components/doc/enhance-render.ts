// Replays the ops from applyEnhancePlan (meeting-recorder/enhance-plan.ts)
// against a live BlockNoteEditor — the merge logic is pure and editor-free;
// this is the thin adapter that turns its output into real editor calls.
// Sibling to insert.ts on purpose: same "plain types in, editor calls out"
// shape, kept out of meeting-recorder since it's BlockNote-specific.

import {
  actionItemMatchesBlock,
  ENHANCE_MARK_ADDED,
  ENHANCE_MARK_PRIOR,
  markOfProps,
  type EditorOp,
  type EnhanceActionItem,
  type EnhanceMark,
  type EnhanceMarkEntry,
  type EnhanceOpBlock,
  snapshotTree,
  type SnapshotBlock,
} from "~/components/meeting-recorder/enhance-plan";
import { blockOwnText } from "./schema/configs";
import type { DocBlock, DocEditorInstance, DocPartialBlock } from "./schema/build";

/** Citation chip href: an ordinary link, not a new inline node (spec §3) —
 *  the transcript panel reads `&at=` to scroll to and highlight the line.
 *  `notePath` is the page hosting the note (a Drive page, an interview). */
export function citationHref(notePath: string, recordingId: string, atSeconds: number): string {
  return `${notePath}?transcript=${encodeURIComponent(recordingId)}&at=${Math.max(0, Math.round(atSeconds))}`;
}

/** The collapsed "### Transcript" toggle both Insert transcript and Enhance
 *  apply append — a shared shape so de-duplication (findTranscriptToggle)
 *  can recognize either one's output. */
export function transcriptToggleBlock(paragraphs: string[]): DocPartialBlock {
  return {
    type: "heading",
    props: { level: 3, isToggleable: true },
    content: [{ type: "text", text: "Transcript", styles: {} }],
    children: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text, styles: {} }],
    })),
  } as DocPartialBlock;
}

/** The document's "Transcript" toggle heading, if it has one — pure (reads
 *  plain block data, no editor) so both `hasTranscriptToggle` (below) and a
 *  speaker rename's "rewrite the toggle's children" path (documents.$pageId.tsx's
 *  onSpeakersChanged) share one lookup instead of two copies drifting apart. */
export function findTranscriptToggle(blocks: readonly DocBlock[]): DocBlock | null {
  return (
    blocks.find(
      (b) => b.type === "heading" && Boolean((b.props as { isToggleable?: boolean }).isToggleable) && blockOwnText(b) === "Transcript",
    ) ?? null
  );
}

/** The top-level blocks Enhance reads and merges against: the document minus
 *  its Transcript toggle. The toggle holds the raw transcript Insert already
 *  wrote, so Enhance would otherwise anchor new notes below it or try to
 *  rewrite its heading. */
export function enhanceSnapshotBlocks(blocks: readonly DocBlock[]): SnapshotBlock[] {
  const toggle = findTranscriptToggle(blocks);
  return snapshotTree(blocks.filter((b) => b !== toggle));
}

export function hasTranscriptToggle(editor: DocEditorInstance): boolean {
  return findTranscriptToggle(editor.document) !== null;
}

export function formatChipLabel(atSeconds: number, speakerFirstName?: string | null): string {
  const s = Math.max(0, Math.round(atSeconds));
  const m = Math.floor(s / 60);
  const clock = `${m}:${String(s % 60).padStart(2, "0")}`;
  return speakerFirstName ? `${speakerFirstName} · ${clock}` : clock;
}

export type ChipSpeakerAt = (atSeconds: number) => string | null;

/** The block's own text, plus one link chip per cited transcript second.
 *  Exported for the MCP `enhance_meeting_notes` apply path (meeting-notes-
 *  apply.server.ts), which replays the same ops server-side against DocBlock
 *  JSON instead of a live editor — pure function, no editor/React runtime
 *  dependency, safe on the server. */
export function buildInlineContent(
  text: string,
  cites: number[],
  notePath: string,
  recordingId: string,
  speakerAt?: ChipSpeakerAt,
): DocPartialBlock["content"] {
  const content: Array<{ type: "text"; text: string; styles: object } | { type: "link"; href: string; content: string }> =
    [{ type: "text", text, styles: {} }];
  for (const at of cites) {
    content.push({ type: "text", text: " ", styles: {} });
    content.push({ type: "link", href: citationHref(notePath, recordingId, at), content: formatChipLabel(at, speakerAt?.(at)) });
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
  notePath: string,
  recordingId: string,
  ctx: { actionItems?: EnhanceActionItem[]; projectId?: string | null; speakerAt?: ChipSpeakerAt } = {},
): DocPartialBlock {
  const content = buildInlineContent(block.text, block.cites, notePath, recordingId, ctx.speakerAt);
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

function withMark(block: DocPartialBlock, mark: EnhanceMark): DocPartialBlock {
  return {
    ...block,
    props: { ...(block.props as Record<string, unknown> | undefined), backgroundColor: mark },
  } as DocPartialBlock;
}

/**
 * Applies applyEnhancePlan's ops to the live editor inside one BlockNote
 * transaction (editor.transact — @blocknote/core/src/editor/BlockNoteEditor.ts),
 * so the editor's own undo reverts the whole write, never half of it
 * (specs/meeting-recording-rail.md Step 2). Every updated or inserted block
 * is tinted `enhance-added`; a `remove` op tints the block `enhance-prior`
 * instead of deleting it, leaving something for Keep/Revert to act on.
 * Returns the full prior JSON (content/props/children) of every block an
 * "update" op touched, captured before the overwrite — the caller persists
 * this as `StoredEnhanceNotes.priorBlocks` for Revert to restore from.
 */
export function renderEnhanceOps(
  editor: DocEditorInstance,
  ops: EditorOp[],
  ctx: {
    notePath: string;
    recordingId: string;
    actionItems?: EnhanceActionItem[];
    projectId?: string | null;
    speakerAt?: ChipSpeakerAt;
  },
): { priorBlocks: Record<string, unknown> } {
  return editor.transact(() => {
    const priorBlocks: Record<string, unknown> = {};
    for (const op of ops) {
      if (op.kind === "update") {
        const prior = editor.getBlock(op.id);
        if (prior) priorBlocks[op.id] = structuredClone(prior);
        const content = buildInlineContent(op.text, op.cites, ctx.notePath, ctx.recordingId, ctx.speakerAt);
        editor.updateBlock(op.id, {
          content,
          props: { backgroundColor: ENHANCE_MARK_ADDED },
        } as unknown as DocPartialBlock);
        continue;
      }
      if (op.kind === "remove") {
        editor.updateBlock(op.id, {
          props: { backgroundColor: ENHANCE_MARK_PRIOR },
        } as unknown as DocPartialBlock);
        continue;
      }
      const blocks = op.blocks.map((b) => withMark(toPartialBlock(b, ctx.notePath, ctx.recordingId, ctx), ENHANCE_MARK_ADDED));
      if (!blocks.length) continue;
      if (op.kind === "appendChildren") {
        const parent = editor.getBlock(op.parentId);
        if (!parent) continue;
        const lastChild = parent.children.at(-1);
        if (lastChild) editor.insertBlocks(blocks, lastChild, "after");
        else editor.updateBlock(parent.id, { children: blocks } as DocPartialBlock);
        continue;
      }
      if (op.afterId === null) {
        const doc = editor.document;
        if (doc.length > 0) editor.insertBlocks(blocks, doc[0]!, "before");
        else editor.replaceBlocks(editor.document, blocks);
      } else {
        editor.insertBlocks(blocks, op.afterId, "after");
      }
    }
    return { priorBlocks };
  });
}

function enhanceMarkOf(block: { props: Record<string, unknown> }): EnhanceMark | null {
  return markOfProps(block.props);
}

/** Every block carrying a reserved Enhance mark, at any depth, in document
 *  order — the data the rail's "pending review" state derives from
 *  (specs/meeting-recording-rail.md Step 2: "Pending is derived from the
 *  document, not from a flag"). */
export function findEnhanceMarks(blocks: readonly DocBlock[]): EnhanceMarkEntry[] {
  const hits: EnhanceMarkEntry[] = [];
  const walk = (list: readonly DocBlock[]) => {
    for (const block of list) {
      const mark = enhanceMarkOf(block);
      if (mark) hits.push({ id: block.id, mark, type: block.type, text: blockOwnText(block) });
      walk(block.children);
    }
  };
  walk(blocks);
  return hits;
}

export function hasEnhanceMarks(blocks: readonly DocBlock[]): boolean {
  return blocks.some((block) => enhanceMarkOf(block) !== null || hasEnhanceMarks(block.children));
}

/** Clears a block's Enhance tint without otherwise changing it. No-op when
 *  `id` no longer exists. */
export function clearEnhanceMark(editor: DocEditorInstance, id: string): void {
  if (!editor.getBlock(id)) return;
  editor.updateBlock(id, { props: { backgroundColor: "default" } } as unknown as DocPartialBlock);
}

/** Keep: clears the tint on a changed/added block, or deletes a removed
 *  (`enhance-prior`) block outright — the template heading Enhance would
 *  have removed on apply. No-op when `id` no longer exists or carries no
 *  mark. */
export function keepEnhanceBlock(editor: DocEditorInstance, id: string): void {
  const block = editor.getBlock(id);
  if (!block) return;
  const mark = enhanceMarkOf(block);
  if (mark === ENHANCE_MARK_PRIOR) {
    editor.removeBlocks([id]);
    return;
  }
  if (mark === ENHANCE_MARK_ADDED) {
    clearEnhanceMark(editor, id);
  }
}

/** Revert: restores a changed block from `priorBlocks`, deletes an added
 *  block that has no prior entry (a genuine insert), or clears the tint on
 *  a removed (`enhance-prior`) block, leaving it as it was. No-op when `id`
 *  no longer exists or carries no mark. */
export function revertEnhanceBlock(
  editor: DocEditorInstance,
  id: string,
  priorBlocks: Record<string, unknown>,
): void {
  const block = editor.getBlock(id);
  if (!block) return;
  const mark = enhanceMarkOf(block);
  if (mark === ENHANCE_MARK_PRIOR) {
    clearEnhanceMark(editor, id);
    return;
  }
  if (mark !== ENHANCE_MARK_ADDED) return;
  const prior = priorBlocks[id] as (Record<string, unknown> & { id?: string }) | undefined;
  if (!prior) {
    editor.removeBlocks([id]);
    return;
  }
  // Children are left as they are now: Enhance may have nested its own
  // (separately reviewed) bullets under this block since prior was captured.
  const { id: _priorId, children: _priorChildren, ...update } = prior;
  editor.updateBlock(id, update as DocPartialBlock);
}

/** Keep every block currently carrying an Enhance mark, in one transaction.
 *  Iterates the marks present when called and skips an id that's already
 *  gone by the time its turn comes (specs/meeting-recording-rail.md Step 2:
 *  "Concurrent review"). Returns the number kept. */
export function keepAllEnhance(editor: DocEditorInstance): number {
  return editor.transact(() => {
    const marks = findEnhanceMarks(editor.document);
    let count = 0;
    for (const { id } of marks) {
      if (!editor.getBlock(id)) continue;
      keepEnhanceBlock(editor, id);
      count++;
    }
    return count;
  });
}

/** Revert every block currently carrying an Enhance mark, in one
 *  transaction. Same skip-if-already-gone behavior as keepAllEnhance.
 *  Returns the number reverted. */
export function revertAllEnhance(editor: DocEditorInstance, priorBlocks: Record<string, unknown>): number {
  return editor.transact(() => {
    const marks = findEnhanceMarks(editor.document);
    let count = 0;
    for (const { id } of marks) {
      if (!editor.getBlock(id)) continue;
      revertEnhanceBlock(editor, id, priorBlocks);
      count++;
    }
    return count;
  });
}

const ENHANCE_MARK_HTML_FORMATS = [
  { format: "blocknote/html", raw: true },
  { format: "text/html", raw: false },
] as const;

/** Strips a `data-background-color="enhance-added"` / `"enhance-prior"`
 *  attribute out of pasted HTML. A block carrying one of these copied out
 *  of a note (or back into the same one) would otherwise arrive tinted with
 *  no recording behind it to Keep or Revert against (specs/meeting-
 *  recording-rail.md Step 2: "Marks and the rest of the note"). Every other
 *  `data-background-color` value, and everything else in the markup, is
 *  left untouched. */
export function stripEnhanceMarksFromHtml(html: string): string {
  return html.replace(
    new RegExp(`\\s*data-background-color\\s*=\\s*(["'])(${ENHANCE_MARK_ADDED}|${ENHANCE_MARK_PRIOR})\\1`, "gi"),
    "",
  );
}

type PasteCapableEditor = { pasteHTML: (html: string, raw?: boolean) => void };

/** BlockNote `pasteHandler` option (passed to useCreateBlockNote in
 *  DocEditorImpl). Intercepts only the two clipboard HTML formats that can
 *  carry a `data-background-color` attribute, in the same priority
 *  BlockNote's own default handler picks between them (`blocknote/html`
 *  over `text/html` — @blocknote/core/src/api/clipboard/fromClipboard/
 *  pasteExtension.ts), and strips the two reserved values before handing
 *  the HTML to the editor. Every other clipboard format (markdown, plain
 *  text, files, code) is untouched — delegated straight to
 *  `defaultPasteHandler`. */
export function enhancePasteHandler({
  event,
  editor,
  defaultPasteHandler,
}: {
  event: ClipboardEvent;
  editor: PasteCapableEditor;
  defaultPasteHandler: (opts?: { prioritizeMarkdownOverHTML?: boolean; plainTextAsMarkdown?: boolean }) => boolean | undefined;
}): boolean | undefined {
  const data = event.clipboardData;
  if (data) {
    for (const { format, raw } of ENHANCE_MARK_HTML_FORMATS) {
      if (!data.types.includes(format)) continue;
      const html = data.getData(format);
      if (html.includes(ENHANCE_MARK_ADDED) || html.includes(ENHANCE_MARK_PRIOR)) {
        editor.pasteHTML(stripEnhanceMarksFromHtml(html), raw);
        return true;
      }
      break;
    }
  }
  return defaultPasteHandler();
}
