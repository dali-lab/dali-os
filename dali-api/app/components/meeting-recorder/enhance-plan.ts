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

/** One top-level block's id, type, and own text (not its children) — what
 *  both the enhance request and the client-side merge key blocks on. */
export type SnapshotBlock = { id: string; type: string; text: string };

export type EnhanceBlockKeepOp = { id: string; op: "keep" };
export type EnhanceBlockExpandOp = { id: string; op: "expand"; text: string; cites?: number[] };
export type EnhanceBlockInsertOp = {
  op: "insert";
  after: string | null;
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
};

export type ApplyEnhancePlanResult = {
  ops: EditorOp[];
  /** expand ops skipped because the live block changed since the snapshot. */
  skipped: number;
  /** empty template headings removed (untouchedTemplate only). */
  hiddenHeadings: number;
};

function isHeading(block: SnapshotBlock): boolean {
  return block.type === "heading";
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
      const id = snapshot[i]!.id;
      if (currentIds.has(id)) return id;
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
  const currentOrder = current.map((b) => b.id);

  const ops: EditorOp[] = [];
  let skipped = 0;
  const insertedAfter = new Set<string | null>();

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
    const afterId =
      blockOp.after === null ? null : resolveInsertAnchor(blockOp.after, snapshot, currentIds, currentOrder);
    const newBlock: EnhanceOpBlock = {
      type: blockOp.type,
      text: blockOp.text,
      cites: blockOp.cites ?? [],
      added: blockOp.added ?? true,
    };
    const last = ops[ops.length - 1];
    if (last && last.kind === "insertAfter" && last.afterId === afterId) {
      last.blocks.push(newBlock);
    } else {
      ops.push({ kind: "insertAfter", afterId, blocks: [newBlock] });
    }
    insertedAfter.add(afterId);
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
