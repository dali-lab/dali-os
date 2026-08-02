// Streaming apply engine: progressively writes AI output into the document
// as SSE deltas arrive, then finalizes on done.
//
// ID tracking: replaceBlocks returns {insertedBlocks} (ids come from there);
// insertBlocks returns Block[] (ids come directly). We always re-track after
// each replace so we're targeting the current live ids.
//
// Throttle: re-parse + replace at most once per ~200ms (trailing). This creates
// one undo step per tick during streaming — accepted v1 tradeoff; a single large
// transaction would require buffering all deltas before applying any.
//
// Snapshot semantics: originalSnapshot holds the full block JSON of the
// replaced selection at the time of the FIRST stream start (not follow-ups),
// so Revert always restores the true pre-AI state regardless of how many
// follow-up turns have run.

import type { DocEditorInstance, DocPartialBlock } from "../schema/build";

export interface StreamApplyEngine {
  /** Call on each SSE delta. */
  onDelta(delta: string): void;
  /** Call when the stream is done (all deltas received). */
  onDone(): void;
  /** Cancel the throttle timer and flush final parse. */
  finalize(): void;
  /** Current accumulated markdown (for history recording). */
  readonly accumulated: string;
  /** Ids of the blocks currently owned by AI in the document. */
  readonly aiBlockIds: string[];
}

export interface StreamApplyOptions {
  editor: DocEditorInstance;
  /** Block ids to replace (replace mode). Empty array = insert mode. */
  selectionIds: string[];
  /** Block to insert after (insert mode). Ignored in replace mode. */
  anchorId: string | null;
  toastError: (msg: string) => void;
  /** Called on each tick with the current AI block ids (for cursor plugin). */
  onAiBlocksChange?: (ids: string[]) => void;
  /** Called when empty parse is confirmed on done (no content). */
  onEmpty?: () => void;
}

export function createStreamApplyEngine(opts: StreamApplyOptions): StreamApplyEngine {
  const { editor, selectionIds, anchorId, toastError, onAiBlocksChange, onEmpty } = opts;
  let accumulated = "";
  let aiBlockIds: string[] = [];
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastApplied = "";

  const isReplaceMode = selectionIds.length > 0;

  function parseBlocks(md: string): DocPartialBlock[] {
    if (!md.trim()) return [];
    return editor.tryParseMarkdownToBlocks(md) as DocPartialBlock[];
  }

  function applyBlocks(blocks: DocPartialBlock[]): void {
    if (blocks.length === 0) return;
    try {
      if (aiBlockIds.length === 0) {
        // First apply.
        if (isReplaceMode) {
          const result = editor.replaceBlocks(selectionIds, blocks);
          aiBlockIds = result.insertedBlocks.map((b) => b.id);
        } else {
          const anchor = anchorId
            ? { id: anchorId }
            : editor.document[editor.document.length - 1] ?? { id: "" };
          const inserted = editor.insertBlocks(blocks, anchor, "after");
          aiBlockIds = inserted.map((b) => b.id);
        }
      } else {
        // Subsequent tick: replace the current AI-owned blocks.
        const result = editor.replaceBlocks(aiBlockIds, blocks);
        aiBlockIds = result.insertedBlocks.map((b) => b.id);
      }
      onAiBlocksChange?.(aiBlockIds);
    } catch {
      // Collab race: blocks were deleted by a collaborator.
      toastError("AI result could not be applied — document was modified by a collaborator.");
      aiBlockIds = [];
    }
  }

  function tick() {
    if (accumulated === lastApplied) return;
    lastApplied = accumulated;
    const blocks = parseBlocks(accumulated);
    if (blocks.length === 0) return; // keep waiting for more content
    applyBlocks(blocks);
  }

  function scheduleThrottle() {
    // ~200ms trailing throttle — see comment above about undo tradeoff.
    if (throttleTimer !== null) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      tick();
    }, 200);
  }

  return {
    onDelta(delta: string) {
      accumulated += delta;
      scheduleThrottle();
    },

    onDone() {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      // Final exact parse.
      const blocks = parseBlocks(accumulated);
      if (blocks.length === 0) {
        onEmpty?.();
        return;
      }
      applyBlocks(blocks);
    },

    finalize() {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      // Apply whatever we have.
      const blocks = parseBlocks(accumulated);
      if (blocks.length > 0) applyBlocks(blocks);
    },

    get accumulated() { return accumulated; },
    get aiBlockIds() { return aiBlockIds; },
  };
}
