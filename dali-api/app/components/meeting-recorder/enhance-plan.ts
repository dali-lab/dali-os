// Pure merge logic for Enhance (specs/meeting-notes-model.md §2). Client-safe:
// no React, no editor import — applyEnhancePlan takes plain snapshots of the
// editor's top-level blocks and returns a list of operations for
// renderEnhanceOps (app/components/doc/enhance-render.ts) to replay against
// the live BlockNoteEditor.
//
// The server (api.ai.meeting-notes.enhance.ts) verifies the model's plan
// before it ever reaches this module — cites and unsupported inserts are
// already dropped by the time applyEnhancePlan runs. This module's only job
// is the client-side merge rule: apply an expand only where the live text
// still matches what the model saw, insert where it was told to (or the
// closest faithful fallback when that anchor is gone), and — for an
// untouched-template note only — drop headings the model never filled in.
//
// Also owns the pure half of inline review (specs/meeting-recording-rail.md
// Step 2): classifying a mark as Added/Changed/Removed, the change-list row
// shape, and detecting a local edit on an already-marked block — all plain
// data in, plain data out, so use-meeting-recording.ts and the in-note review
// can unit-test them without a live BlockNote editor. blockOwnText (below) is
// itself editor-free (doc/schema/configs.ts), so this module stays safe
// everywhere enhance-plan.ts already was (client and server).

import { blockOwnText } from "~/components/doc/schema/configs";

/** One block's id, type, and own text (not its children) — what both the
 *  enhance request and the client-side merge key blocks on. Nested blocks
 *  carry their parent's id. */
export type SnapshotBlock = { id: string; type: string; text: string; parentId?: string };

type TreeBlock = { id: string; type: string; content?: unknown; children?: readonly TreeBlock[] };

/** True for the href doc/enhance-render.ts's citationHref builds. */
export function isCitationHref(href: unknown): boolean {
  return typeof href === "string" && /[?&]transcript=[^&#]+&at=\d+$/.test(href);
}

// Citation chips are links Enhance appends, not the author's words: left in,
// their labels end up in task titles and read as author text to Enhance again.
export function ownTextWithoutCitations(b: TreeBlock): string {
  const block = b as Parameters<typeof blockOwnText>[0];
  if (!Array.isArray(b.content)) return blockOwnText(block);
  const content = (b.content as { type?: string; href?: unknown }[]).filter((n) => !(n.type === "link" && isCitationHref(n.href)));
  if (content.length === b.content.length) return blockOwnText(block);
  return blockOwnText({ ...block, content } as typeof block).trimEnd();
}

/** The tree flattened in document order, skipping blank leaf blocks (the
 *  trailing empty paragraph every BlockNote doc keeps, spacer lines). */
export function snapshotTree(blocks: readonly TreeBlock[], parentId?: string): SnapshotBlock[] {
  return blocks.flatMap((b) => {
    const text = ownTextWithoutCitations(b);
    const children = snapshotTree(b.children ?? [], b.id);
    if (!text.trim() && children.length === 0) return [];
    return [{ id: b.id, type: b.type, text, ...(parentId ? { parentId } : {}) }, ...children];
  });
}

export type EnhanceBlockKeepOp = { id: string; op: "keep" };
export type EnhanceBlockExpandOp = { id: string; op: "expand"; text: string; cites?: number[] };
export type EnhanceBlockInsertOp = {
  op: "insert";
  after: string | null;
  /** Insert as the last child of this block instead of after `after`. */
  under?: string;
  type: string;
  text: string;
  cites?: number[];
  added?: boolean;
};
export type EnhanceBlockOp = EnhanceBlockKeepOp | EnhanceBlockExpandOp | EnhanceBlockInsertOp;

export type EnhanceActionItem = {
  text: string;
  ownerName?: string | null;
  ownerUserId?: string | null;
  due?: string | null;
  dueSource?: string | null;
  cites?: number[];
  /** Set server-side once Create tasks (specs/meeting-notes-model.md §4) makes
   *  a Task for this item — never sent by the model, only written back by
   *  POST /api/meeting-recordings/:id {action:"createTasks"}. Its presence is
   *  the dedup guard: a re-run never creates a second task for the same item. */
  taskId?: string | null;
};

export type EnhancePlan = {
  blocks: EnhanceBlockOp[];
  actionItems: EnhanceActionItem[];
};

/** A block to insert — mirrors EnhanceBlockInsertOp minus the anchor, since
 *  several inserts anchored at the same surviving block collapse into one
 *  insertAfter op (see applyEnhancePlan). */
export type EnhanceOpBlock = { type: string; text: string; cites: number[]; added: boolean };

export type EditorOp =
  | { kind: "update"; id: string; text: string; cites: number[] }
  | { kind: "insertAfter"; afterId: string | null; blocks: EnhanceOpBlock[] }
  | { kind: "appendChildren"; parentId: string; blocks: EnhanceOpBlock[] }
  // The bottom of the note, above the Transcript toggle when there is one.
  | { kind: "appendAtEnd"; blocks: EnhanceOpBlock[] }
  // Not in the original sketch, but required to implement "template headings
  // the model left empty are hidden (removed) on apply" (spec §2) — there is
  // no way to express a removal with only update/insertAfter.
  | { kind: "remove"; id: string };

/** What the server's verification pass (api.ai.meeting-notes.enhance.ts)
 *  dropped before the plan ever reached the client. */
export type EnhanceVerified = {
  droppedCites: number;
  droppedBlocks: number;
  unmatchedOwners: number;
};

/** The two reserved `backgroundColor` values Enhance writes to mark a block
 *  pending review (specs/meeting-recording-rail.md Step 2) — plain strings
 *  on BlockNote's existing per-block prop, never offered by the Colors
 *  sub-menu. "added" covers both a changed block (kept its id, new text) and
 *  a genuinely new block; "prior" marks a block Enhance would otherwise have
 *  removed outright (an untouched-template heading), left in place instead
 *  so Keep/Revert has something to act on. */
export const ENHANCE_MARK_ADDED = "enhance-added" as const;
export const ENHANCE_MARK_PRIOR = "enhance-prior" as const;
export type EnhanceMark = typeof ENHANCE_MARK_ADDED | typeof ENHANCE_MARK_PRIOR;

/** A block currently carrying a reserved mark — findEnhanceMarks's (app/
 *  components/doc/enhance-render.ts) return element, duplicated here as a
 *  type only so this module doesn't import the editor-bound one. */
export type EnhanceMarkEntry = { id: string; mark: EnhanceMark; type: string; text: string };

/** The reserved mark on a block's own `props`, or null — the one spot this
 *  check lives; doc/enhance-render.ts's enhanceMarkOf and DocSideMenu both
 *  delegate here instead of keeping their own copy. */
export function markOfProps(props: Record<string, unknown> | undefined): EnhanceMark | null {
  const bg = props?.backgroundColor;
  return bg === ENHANCE_MARK_ADDED || bg === ENHANCE_MARK_PRIOR ? bg : null;
}

/** The shape stored on MeetingRecording.notes and returned by both the
 *  enhance endpoint and GET /api/meeting-recordings/:id. */
export type StoredEnhanceNotes = {
  plan: EnhancePlan;
  verified: EnhanceVerified;
  /** ISO timestamp of the editor snapshot the plan was computed from — the
   *  enhance lock compares this to a later apply's own snapshot. */
  snapshotAt: string;
  /** The exact top-level blocks sent with the request — applyEnhancePlan's
   *  baseline for "did this block change since the plan was generated",
   *  round-tripped through storage so a page reload doesn't lose it. */
  snapshot: SnapshotBlock[];
  /** The roster resolveMeetingEnhanceContext used for this plan (occurrence
   *  attendance + the note's project current-term members, specs/meeting-
   *  notes-model.md §6) — the EnhanceSheet's owner picker prefers this over
   *  the page's own occurrence-only roster prop. Optional: absent on plans
   *  stored before this field existed. */
  roster?: { userId: string; name: string }[];
  /** Full prior DocBlock JSON (content/props/children), keyed by block id,
   *  for every block an "update" op changed — captured by renderEnhanceOps
   *  before it overwrites the block, so Revert restores the original inline
   *  styles, links, comment marks, and task chips rather than plain text. */
  priorBlocks?: Record<string, unknown>;
  /** ISO timestamp set when the last enhance-added/enhance-prior mark on
   *  this note cleared, by any means — informational, lets the nudge job
   *  and MCP tell "enhanced" from "enhanced and reviewed". */
  reviewedAt?: string | null;
};

export type ApplyEnhancePlanResult = {
  ops: EditorOp[];
  /** expand ops skipped because the live block changed since the snapshot. */
  skipped: number;
  /** empty template headings removed (untouchedTemplate only). */
  hiddenHeadings: number;
};

const ACTION_ITEMS_HEADING = "Action items";

function isActionItemsHeading(text: string): boolean {
  return text.trim().toLowerCase().replace(/[:\s]+$/, "") === "action items";
}

function isHeading(block: SnapshotBlock): boolean {
  return block.type === "heading" && !block.parentId;
}

/** Index of the heading that starts `index`'s section: itself if it's a
 *  heading, else the nearest preceding heading, else 0. Headings are treated
 *  as one flat level here — SnapshotBlock carries no heading level, and every
 *  shipped meeting-note template uses a single level, so "equal or higher
 *  level" collapses to "any heading". */
function sectionStart(blocks: SnapshotBlock[], index: number): number {
  for (let i = index; i >= 0; i--) {
    if (isHeading(blocks[i]!)) return i;
  }
  return 0;
}

/** Exclusive end of the section starting at `start`: the next heading, or the
 *  end of the list. */
function sectionEnd(blocks: SnapshotBlock[], start: number): number {
  for (let i = start + 1; i < blocks.length; i++) {
    if (isHeading(blocks[i]!)) return i;
  }
  return blocks.length;
}

/**
 * Resolves an insert's `after` anchor against the live block list:
 *   1. the named block, if it's still there;
 *   2. else the last surviving block in its snapshot section;
 *   3. else the last block in the live doc;
 *   4. else null (the live doc is empty — insert at the start).
 */
function resolveInsertAnchor(
  afterId: string,
  snapshot: SnapshotBlock[],
  currentIds: Set<string>,
  currentOrder: string[],
): string | null {
  if (currentIds.has(afterId)) return afterId;

  const snapIndex = snapshot.findIndex((b) => b.id === afterId);
  if (snapIndex >= 0) {
    const start = sectionStart(snapshot, snapIndex);
    const end = sectionEnd(snapshot, start);
    for (let i = end - 1; i >= start; i--) {
      const { id, parentId } = snapshot[i]!;
      if (!parentId && currentIds.has(id)) return id;
    }
  }

  return currentOrder.length > 0 ? currentOrder[currentOrder.length - 1]! : null;
}

/**
 * Merges a verified EnhancePlan into the live editor's current blocks,
 * producing an ordered list of operations for renderEnhanceOps to apply.
 * Pure and deterministic: same inputs, same ops, every time.
 */
export function applyEnhancePlan(
  snapshot: SnapshotBlock[],
  current: SnapshotBlock[],
  plan: EnhancePlan,
  opts: { untouchedTemplate: boolean } = { untouchedTemplate: false },
): ApplyEnhancePlanResult {
  const snapshotById = new Map(snapshot.map((b) => [b.id, b]));
  const currentById = new Map(current.map((b) => [b.id, b]));
  const currentIds = new Set(current.map((b) => b.id));
  const topLevel = current.filter((b) => !b.parentId);
  const currentOrder = topLevel.map((b) => b.id);

  const ops: EditorOp[] = [];
  let skipped = 0;
  const insertedAfter = new Set<string | null>();
  // Every insert at one anchor lands in one op, in plan order: two separate
  // "insert after X" ops would render the later one above the earlier.
  const insertOps = new Map<string, Extract<EditorOp, { kind: "insertAfter" | "appendChildren" }>>();
  const addInsert = (where: { afterId: string | null } | { parentId: string }, blocks: EnhanceOpBlock[]) => {
    const key = "parentId" in where ? `under:${where.parentId}` : `after:${where.afterId ?? ""}`;
    const existing = insertOps.get(key);
    if (existing) {
      existing.blocks.push(...blocks);
    } else {
      const op =
        "parentId" in where
          ? { kind: "appendChildren" as const, parentId: where.parentId, blocks }
          : { kind: "insertAfter" as const, afterId: where.afterId, blocks };
      insertOps.set(key, op);
      ops.push(op);
    }
    insertedAfter.add("parentId" in where ? where.parentId : where.afterId);
  };

  for (const blockOp of plan.blocks) {
    if (blockOp.op === "keep") continue;

    if (blockOp.op === "expand") {
      const snap = snapshotById.get(blockOp.id);
      const live = currentById.get(blockOp.id);
      if (!snap || !live || live.text !== snap.text) {
        skipped++;
        continue;
      }
      ops.push({ kind: "update", id: blockOp.id, text: blockOp.text, cites: blockOp.cites ?? [] });
      continue;
    }

    // op === "insert"
    if (blockOp.type === "checkListItem" || (blockOp.type === "heading" && isActionItemsHeading(blockOp.text))) {
      continue;
    }
    const newBlock: EnhanceOpBlock = {
      type: blockOp.type,
      text: blockOp.text,
      cites: blockOp.cites ?? [],
      added: blockOp.added ?? true,
    };
    if (blockOp.under && currentIds.has(blockOp.under)) {
      addInsert({ parentId: blockOp.under }, [newBlock]);
      continue;
    }
    const anchor = blockOp.under ?? blockOp.after;
    const afterId = anchor === null ? null : resolveInsertAnchor(anchor, snapshot, currentIds, currentOrder);
    addInsert({ afterId }, [newBlock]);
  }

  const newItems = plan.actionItems.filter(
    (item) => !current.some((b) => b.type === "checkListItem" && actionItemMatchesBlock(item.text, b.text)),
  );
  if (newItems.length > 0) {
    const items: EnhanceOpBlock[] = newItems.map((item) => ({
      type: "checkListItem",
      text: item.text,
      cites: item.cites ?? [],
      added: true,
    }));
    const headingIndex = topLevel.findIndex((b) => isHeading(b) && isActionItemsHeading(b.text));
    if (headingIndex >= 0) {
      addInsert({ afterId: topLevel[sectionEnd(topLevel, headingIndex) - 1]!.id }, items);
    } else {
      const heading: EnhanceOpBlock = { type: "heading", text: ACTION_ITEMS_HEADING, cites: [], added: true };
      ops.push({ kind: "appendAtEnd", blocks: [heading, ...items] });
    }
  }

  let hiddenHeadings = 0;
  if (opts.untouchedTemplate) {
    for (const blockOp of plan.blocks) {
      if (blockOp.op !== "keep") continue;
      const live = currentById.get(blockOp.id);
      if (!live || !isHeading(live)) continue;
      if (insertedAfter.has(blockOp.id)) continue;
      ops.push({ kind: "remove", id: blockOp.id });
      hiddenHeadings++;
    }
  }

  return { ops, skipped, hiddenHeadings };
}

function normalizeActionItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether an action item's text and a checklist block's rendered text are
 * "the same item" (fix for action items into Tasks never finding their
 * checklist block, specs/meeting-notes-model.md §4): normalized equal, or one
 * normalized string contains the other and the shorter side is long enough
 * (12+ chars) that a short common fragment can't false-positive. Used both to
 * find a checklist block to link a created task to, and — on a re-run — to
 * carry a `taskId` forward onto the matching item in the new plan.
 */
export function actionItemMatchesBlock(itemText: string, blockText: string): boolean {
  const a = normalizeActionItemText(itemText);
  const b = normalizeActionItemText(blockText);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 12 && longer.includes(shorter);
}

// ─── Inline review: pure helpers (specs/meeting-recording-rail.md Step 2) ──

/** One block changed/inserted/deleted/moved by a single BlockNote transaction
 *  — the shape of an element in editor.onChange's getChanges() result
 *  (@blocknote/core's BlocksChanged), narrowed to only the fields this module
 *  reads so it never needs the real (editor-bound) type. */
export type EnhanceBlockChange = {
  type: "insert" | "update" | "delete" | "move";
  source: { type: string };
  block: { id: string; props?: Record<string, unknown> };
  prevBlock?: { id: string; props?: Record<string, unknown> } | null;
};

const LOCAL_CHANGE_SOURCE_TYPES = new Set(["local", "paste", "drop"]);

/** True when the transaction is purely an undo/redo: some change says so and
 *  none is a local, paste or drop edit. */
export function isUndoRedoTransaction(changes: readonly EnhanceBlockChange[]): boolean {
  return (
    changes.some((c) => c.source.type === "undo-redo") &&
    !changes.some((c) => LOCAL_CHANGE_SOURCE_TYPES.has(c.source.type))
  );
}

/**
 * Block ids a local edit should count as Keep for: an "update" change, from
 * this client (not a remote Yjs update, not undo/redo), where the block
 * already carried a reserved mark BEFORE this change AND still carries one
 * now. The "still carries one now" half is what makes this safe to call
 * again on the change produced by clearing the mark itself — by then the
 * block's current mark is gone, so it drops out and nothing recurses.
 * `marks` is the reserved-mark list as of AFTER this change (e.g.
 * findEnhanceMarks(editor.document), called fresh in the onChange handler).
 */
export function localEditKeepIds(
  changes: readonly EnhanceBlockChange[],
  marks: readonly Pick<EnhanceMarkEntry, "id">[],
): string[] {
  const markedIds = new Set(marks.map((m) => m.id));
  const kept = new Set<string>();
  for (const change of changes) {
    if (change.type !== "update") continue;
    if (!LOCAL_CHANGE_SOURCE_TYPES.has(change.source.type)) continue;
    if (!markedIds.has(change.block.id)) continue;
    if (!markOfProps(change.prevBlock?.props)) continue;
    kept.add(change.block.id);
  }
  return [...kept];
}

/** First line of a block's own text — what the rail row and the side-menu
 *  item both show instead of the whole (possibly multi-line) block. */
export function firstLineOf(text: string): string {
  const i = text.indexOf("\n");
  return (i === -1 ? text : text.slice(0, i)).trim();
}

/** Added/Changed/Removed for one marked block (spec: "a block with the added
 *  mark whose id is in priorBlocks is Changed; otherwise Added; prior mark is
 *  Removed"). */
export function classifyEnhanceMark(
  hit: Pick<EnhanceMarkEntry, "id" | "mark">,
  priorBlocks: Record<string, unknown> | undefined,
): "Added" | "Changed" | "Removed" {
  if (hit.mark === ENHANCE_MARK_PRIOR) return "Removed";
  return priorBlocks && Object.prototype.hasOwnProperty.call(priorBlocks, hit.id) ? "Changed" : "Added";
}

/** Counts for the rail's "N changed, N added, N removed" status line. */
export function summarizeEnhanceMarks(
  marks: readonly Pick<EnhanceMarkEntry, "id" | "mark">[],
  priorBlocks: Record<string, unknown> | undefined,
): { changed: number; added: number; removed: number } {
  const counts = { changed: 0, added: 0, removed: 0 };
  for (const m of marks) {
    const kind = classifyEnhanceMark(m, priorBlocks);
    if (kind === "Changed") counts.changed++;
    else if (kind === "Added") counts.added++;
    else counts.removed++;
  }
  return counts;
}

/** The nearest heading strictly before `id` in document order, or null —
 *  context for the rail's change-list row. Walks the FULL top-level block
 *  list (not just the marked ones), since the nearest heading is often an
 *  untouched block. */
export function headingAbove(blocks: readonly SnapshotBlock[], id: string): string | null {
  const index = blocks.findIndex((b) => b.id === id);
  if (index <= 0) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i]!.type === "heading") return blocks[i]!.text;
  }
  return null;
}

export function priorBlockFirstLine(prior: unknown): string | null {
  if (!prior || typeof prior !== "object") return null;
  const text = blockOwnText(prior as Parameters<typeof blockOwnText>[0]);
  return text ? firstLineOf(text) : null;
}

export type EnhanceChangeRow = {
  id: string;
  kind: "Added" | "Changed" | "Removed";
  /** First line of the block's current (post-Enhance) text. */
  text: string;
  /** Nearest heading above the block, for context, or null. */
  heading: string | null;
  /** First line of the block's text before Enhance touched it — Changed
   *  rows only. */
  priorText: string | null;
};

/** The rail's change list, one row per marked block in document order
 *  (findEnhanceMarks already returns them in order). */
export function buildEnhanceChangeRows(
  marks: readonly EnhanceMarkEntry[],
  blocks: readonly SnapshotBlock[],
  priorBlocks: Record<string, unknown> | undefined,
): EnhanceChangeRow[] {
  return marks.map((m) => {
    const kind = classifyEnhanceMark(m, priorBlocks);
    return {
      id: m.id,
      kind,
      text: firstLineOf(m.text),
      heading: headingAbove(blocks, m.id),
      priorText: kind === "Changed" ? priorBlockFirstLine(priorBlocks?.[m.id]) : null,
    };
  });
}
