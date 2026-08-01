// AiPreviewDialog — review AI output before touching the document.
//
// Nothing reaches the document until the user clicks Apply or Insert below.
// The dialog is rendered by DocView (DocEditorImpl.tsx) when pendingAiResult
// is set; Discard/close clears it.
//
// Preview: markdown is parsed via editor.tryParseMarkdownToBlocks() (pure parse,
// synchronous — no mutation) and rendered by a read-only local-mode <DocEditor>
// so the user sees full-fidelity block formatting rather than raw markdown.
//
// Selective accept (multi-block results only): one checkbox row per top-level
// block — all checked by default. Unchecking a box excludes that block (plus
// any nested children) from what gets applied.
//
// Apply semantics (match AiPendingResult.mode):
//   "replace" → replaceBlocks(scopeBlockIds, checkedBlocks)
//   "insert"  → insertBlocks(checkedBlocks, afterBlockId, "after")
//
// Insert below button (mode="replace" only): keeps original content and inserts
// checked blocks after the scope — useful when you want to ADD the rewrite
// rather than swap it in.
//
// Collaborator-race guard delegated to applyAiResult in apply.ts.

import React, { useId, useMemo, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { DocEditor } from "~/components/doc/DocEditor";
import { blockExcerpt, filterCheckedBlocks, applyAiResult } from "./apply";
import type { AiPendingResult } from "./apply";
import type { DocEditorInstance, DocPartialBlock } from "../schema/build";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AiPreviewDialogProps {
  editor: DocEditorInstance;
  result: AiPendingResult;
  onClose: () => void;
  toastInfo: (msg: string) => void;
  toastError: (msg: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiPreviewDialog({
  editor,
  result,
  onClose,
  toastInfo,
  toastError,
}: AiPreviewDialogProps) {
  const titleId = useId();

  // Parse markdown synchronously — tryParseMarkdownToBlocks is a pure
  // synchronous parser on the live editor instance; it does NOT mutate the doc.
  const blocks: DocPartialBlock[] = useMemo(
    () =>
      editor.tryParseMarkdownToBlocks(result.markdown) as DocPartialBlock[],
    // Re-parse only when the result changes (i.e. a new AI response arrived).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result.markdown],
  );

  // Checked state: all blocks checked by default (indices 0..n-1).
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(
    () => new Set(blocks.map((_, i) => i)),
  );

  const isMultiBlock = blocks.length > 1;
  const checkedBlocks = filterCheckedBlocks(blocks, checkedIndices);
  const noneChecked = checkedBlocks.length === 0;

  const toggleBlock = (idx: number) => {
    setCheckedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleApply = async () => {
    await applyAiResult({ editor, result, blocks: checkedBlocks, toastInfo, toastError });
    onClose();
  };

  // "Insert below" is only meaningful for replace actions: keep the original
  // and INSERT the checked blocks after the scope rather than swapping them.
  const handleInsertBelow = async () => {
    await applyAiResult({
      editor,
      result: { ...result, mode: "insert" },
      blocks: checkedBlocks,
      toastInfo,
      toastError,
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      // Wider than the default max-w-md to give the preview enough room.
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-2xl w-full p-5 sm:p-6 my-auto"
    >
      <ModalHeader
        titleId={titleId}
        title={`${result.actionLabel} — ${result.scopeLabel}`}
        onClose={onClose}
      />

      {/* Preview — rendered via read-only DocEditor for full block fidelity */}
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border bg-muted/30">
        {blocks.length === 0 ? (
          <div className="px-4 py-6 text-sm italic text-muted-foreground">
            (empty response)
          </div>
        ) : (
          <DocEditor
            features="document"
            editable={false}
            density="compact"
            initialContent={blocks}
          />
        )}
      </div>

      {/* Selective accept checklist — only when there are multiple top-level blocks */}
      {isMultiBlock && blocks.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Include in result
          </p>
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {blocks.map((block, idx) => {
              const excerpt = blockExcerpt(block) || `[${block.type ?? "block"} ${idx + 1}]`;
              return (
                <label
                  key={idx}
                  className="flex items-start gap-2 rounded px-2 py-1 hover:bg-muted/60 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={checkedIndices.has(idx)}
                    onChange={() => toggleBlock(idx)}
                    className="mt-0.5 shrink-0 accent-accent-coral"
                  />
                  <span className="text-sm text-foreground/80 truncate">{excerpt}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonClasses("secondary")}>
          Discard
        </button>
        {result.mode === "replace" && (
          <button
            type="button"
            onClick={() => void handleInsertBelow()}
            disabled={noneChecked}
            className={buttonClasses("secondary")}
          >
            Insert below
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={noneChecked}
          className={buttonClasses("primary")}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}
