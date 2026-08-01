// AiPanel — the unified AI lifecycle UI.
//
// Hosts the entire flow in one dialog: scope control + optional instruction →
// auto-run → rendered preview + selective accept → Apply / Insert below / Discard.
// Re-run is available after changing scope or instruction.
//
// Designed HOST-AGNOSTIC: takes plain props, no Modal assumptions baked in —
// DocView wraps it in Modal for v1; a future phase can re-host it inside a
// BlockPopover anchored to the cursor block without touching this component.
//
// Mode/scope → apply-mode decision table (see effectiveApplyMode):
//
//   action    | origin  | scope     | apply mode
//   ──────────┼─────────┼───────────┼───────────
//   improve   | slash   | block     | replace
//   improve   | slash   | document  | replace
//   improve   | toolbar | selection | replace
//   improve   | toolbar | document  | replace
//   fix       | slash   | block     | replace
//   fix       | slash   | document  | replace
//   fix       | toolbar | selection | replace
//   fix       | toolbar | document  | replace
//   summarize | slash   | block     | insert
//   summarize | slash   | document  | insert
//   summarize | toolbar | selection | insert
//   summarize | toolbar | document  | insert
//   prompt    | slash   | block     | insert  (no replacement — slash "Ask AI" inserts)
//   prompt    | slash   | document  | insert
//   prompt    | toolbar | selection | replace (toolbar Ask AI replaces selection)
//   prompt    | toolbar | document  | replace
//   continue  | slash   | —         | insert  (always; scope is implicit)

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { DocEditor } from "~/components/doc/DocEditor";
import type { AiDocAction } from "~/routes/api.ai.doc";
import { blockExcerpt, filterCheckedBlocks, applyAiResult } from "./apply";
import type { AiPendingResult, AiSessionConfig } from "./apply";
import type { DocEditorInstance, DocPartialBlock } from "../schema/build";
import {
  actionLabel,
  capMarkdown,
  getContinueContext,
  getBlockScopeContext,
  getDocumentScopeContext,
  getSelectionContext,
  CONTEXT_CHAR_CAP,
} from "./AiSlashMenuItems";

// Re-export so call sites can import from one place.
export type { AiSessionConfig } from "./apply";

// ── Scope type (what the segmented control represents) ───────────────────────

type SlashScope = "block" | "document";
type ToolbarScope = "selection" | "document";

// ── Apply-mode derivation ────────────────────────────────────────────────────

/**
 * Derive the apply mode (replace vs insert) from the action, origin, and scope.
 * This is the load-bearing decision table for how AI output reaches the document.
 *
 * Extracted as a pure function so it can be unit-tested without a DOM.
 */
export function effectiveApplyMode(
  action: AiDocAction,
  origin: "slash" | "toolbar",
  scope: SlashScope | ToolbarScope,
): "replace" | "insert" {
  if (action === "continue" || action === "summarize") return "insert";
  if (action === "improve" || action === "fix") return "replace";
  // prompt:
  if (origin === "toolbar") return "replace"; // toolbar Ask AI replaces selection
  return "insert"; // slash Ask AI inserts after cursor
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AiPanelProps {
  editor: DocEditorInstance;
  config: AiSessionConfig;
  onClose: () => void;
  toastInfo: (msg: string) => void;
  toastError: (msg: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiPanel({
  editor,
  config,
  onClose,
  toastInfo,
  toastError,
}: AiPanelProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Scope state ─────────────────────────────────────────────────────────────
  //
  // Default scope: "document" when cursor block was empty (block scope would
  // produce empty context), otherwise "block" / "selection".
  const defaultScope: SlashScope | ToolbarScope =
    config.origin === "toolbar"
      ? "selection"
      : config.cursorBlockWasEmpty
        ? "document"
        : "block";

  const [scope, setScope] = useState<SlashScope | ToolbarScope>(defaultScope);

  // ── Instruction state (prompt action only) ──────────────────────────────────
  const [instruction, setInstruction] = useState("");

  // ── Fetch state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  // Tracks whether any run has completed so we know when scope/instruction changes
  // are "after a result" (enabling Re-run) vs before the first run (normal state).
  const [hasResult, setHasResult] = useState(false);
  // Whether scope or instruction changed after the last run (enables Re-run).
  const [dirty, setDirty] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // ── Block parse ─────────────────────────────────────────────────────────────
  const blocks: DocPartialBlock[] = useMemo(
    () =>
      markdown != null
        ? (editor.tryParseMarkdownToBlocks(markdown) as DocPartialBlock[])
        : [],
    // Re-parse only when markdown changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown],
  );

  // ── Checklist state ─────────────────────────────────────────────────────────
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(
    () => new Set(),
  );
  // Reset checklist when blocks change.
  useEffect(() => {
    setCheckedIndices(new Set(blocks.map((_, i) => i)));
  }, [blocks]);

  const isMultiBlock = blocks.length > 1;
  const checkedBlocks = filterCheckedBlocks(blocks, checkedIndices);
  const noneChecked = checkedBlocks.length === 0;

  // ── Context builder ─────────────────────────────────────────────────────────
  //
  // Builds context markdown + block-ids at RUN TIME from the current scope,
  // reading live editor state. Selections captured at invoke time are used for
  // the initial "selection" scope; "document" always reads live.
  async function buildContext(): Promise<{
    context: string;
    scopeBlockIds: string[];
    afterBlockId: string | null;
  }> {
    if (config.action === "continue") {
      const context = await getContinueContext(editor);
      return {
        context,
        scopeBlockIds: [],
        afterBlockId: config.cursorBlockId,
      };
    }

    if (scope === "document") {
      const { markdown: ctx, blockIds } = await getDocumentScopeContext(editor);
      // afterBlockId for insert: last doc block; for replace: not used for inserts
      const lastId =
        editor.document.length > 0
          ? editor.document[editor.document.length - 1].id
          : null;
      return { context: ctx, scopeBlockIds: blockIds, afterBlockId: lastId };
    }

    if (scope === "selection") {
      // Use captured selection ids (selection is long gone by run time).
      const selIds = config.selectionBlockIds ?? [];
      if (!selIds.length) {
        // Fallback: re-derive from live selection (shouldn't happen, but defensive).
        const { markdown: ctx, blockIds } = await getSelectionContext(editor);
        const lastId = blockIds[blockIds.length - 1] ?? null;
        return { context: ctx, scopeBlockIds: blockIds, afterBlockId: lastId };
      }
      // Build context from the captured block ids (read live block content).
      const allBlocks = editor.document;
      const selFiltered = selIds
        .map((id) => allBlocks.find((b) => b.id === id))
        .filter((b): b is NonNullable<typeof b> => b != null);
      const sel = selFiltered as Parameters<typeof editor.blocksToMarkdownLossy>[0];
      const full = selFiltered.length ? editor.blocksToMarkdownLossy(sel) : "";
      const lastId = selIds[selIds.length - 1];
      return {
        context: capMarkdown(full, CONTEXT_CHAR_CAP),
        scopeBlockIds: selIds,
        afterBlockId: lastId,
      };
    }

    // scope === "block"
    const { markdown: ctx, blockIds } = await getBlockScopeContext(editor);
    const afterBlockId = blockIds[blockIds.length - 1] ?? config.cursorBlockId;
    return { context: ctx, scopeBlockIds: blockIds, afterBlockId };
  }

  // ── Run ─────────────────────────────────────────────────────────────────────
  async function run() {
    // Abort any in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setMarkdown(null);
    setDirty(false);

    try {
      const { context, scopeBlockIds, afterBlockId } = await buildContext();

      const res = await fetch("/api/ai/doc", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: config.action,
          instruction: config.action === "prompt" ? instruction : undefined,
          context,
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if ((body as { aiEnabled?: false }).aiEnabled === false) {
          throw new Error("AI is not configured on this server.");
        }
        throw new Error("AI request failed. Please try again.");
      }

      const data = (await res.json()) as { markdown?: string };
      if (controller.signal.aborted) return;

      if (!data.markdown?.trim()) {
        toastInfo("AI returned nothing.");
        setLoading(false);
        setHasResult(true);
        return;
      }

      // Store the scope ids on the result for apply-time use.
      // We stash them in a ref so Apply/Insert below can pick them up.
      pendingContextRef.current = { scopeBlockIds, afterBlockId };
      setMarkdown(data.markdown);
      setHasResult(true);
    } catch (err) {
      if (controller.signal.aborted) return; // silent abort on panel close
      toastError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  // Stash the context ids from the most recent run so Apply can use them.
  const pendingContextRef = useRef<{
    scopeBlockIds: string[];
    afterBlockId: string | null;
  } | null>(null);

  // ── Auto-run on open (all actions except "prompt") ──────────────────────────
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    if (config.action !== "prompt") {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Abort on unmount / close ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Scope/instruction change tracking ───────────────────────────────────────
  function handleScopeChange(next: SlashScope | ToolbarScope) {
    setScope(next);
    if (hasResult) setDirty(true);
  }

  function handleInstructionChange(val: string) {
    setInstruction(val);
    if (hasResult && config.action === "prompt") setDirty(true);
  }

  // ── Apply / Insert below ─────────────────────────────────────────────────────

  function buildPendingResult(overrideMode?: "replace" | "insert"): AiPendingResult | null {
    if (!markdown || !pendingContextRef.current) return null;
    const { scopeBlockIds, afterBlockId } = pendingContextRef.current;
    const mode =
      overrideMode ??
      effectiveApplyMode(config.action, config.origin, scope);
    return {
      mode,
      scopeBlockIds,
      afterBlockId,
      actionLabel: actionLabel(config.action),
      scopeLabel: scope,
      markdown,
    };
  }

  const handleApply = async () => {
    const result = buildPendingResult();
    if (!result) return;
    await applyAiResult({ editor, result, blocks: checkedBlocks, toastInfo, toastError });
    onClose();
  };

  const handleInsertBelow = async () => {
    const result = buildPendingResult("insert");
    if (!result) return;
    await applyAiResult({ editor, result, blocks: checkedBlocks, toastInfo, toastError });
    onClose();
  };

  // ── Derived display state ────────────────────────────────────────────────────

  const applyMode = effectiveApplyMode(config.action, config.origin, scope);
  const showInsertBelow = applyMode === "replace";
  const isPrompt = config.action === "prompt";
  const isContinue = config.action === "continue";
  // Prompt action: show Run button initially; show Re-run after any result + dirty
  // Non-prompt: show Re-run after first result if dirty
  const showRunButton = isPrompt && !hasResult;
  const showReRun = hasResult && dirty;
  // For prompt: also Re-run when instruction changes even without a prior result
  // (but only after user has clicked Run at least once — tracked by hasResult)

  function canRun(): boolean {
    if (loading) return false;
    if (isPrompt) return instruction.trim().length > 0;
    return true;
  }

  // ── Scope label helpers ──────────────────────────────────────────────────────

  function slashScopeLabel(s: SlashScope): string {
    return s === "block" ? "Current block" : "Entire document";
  }

  function toolbarScopeLabel(s: ToolbarScope): string {
    return s === "selection" ? "Selection" : "Entire document";
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <ModalHeader
        titleId={titleId}
        title={actionLabel(config.action)}
        onClose={onClose}
      />

      {/* Scope segmented control — hidden for "continue" (scope is implicit) */}
      {isContinue ? (
        <p className="mb-3 text-xs text-muted-foreground">
          AI will continue writing from where you left off.
        </p>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Apply to</span>
          {config.origin === "slash" ? (
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["block", "document"] as SlashScope[]).map((opt, i) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleScopeChange(opt)}
                  className={[
                    "px-2 py-1",
                    i > 0 ? "border-l border-border" : "",
                    (scope as SlashScope) === opt
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {slashScopeLabel(opt)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["selection", "document"] as ToolbarScope[]).map((opt, i) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleScopeChange(opt)}
                  className={[
                    "px-2 py-1",
                    i > 0 ? "border-l border-border" : "",
                    (scope as ToolbarScope) === opt
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {toolbarScopeLabel(opt)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Instruction input — only for "prompt" action */}
      {isPrompt && (
        <div className="mb-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              What would you like AI to write or do?
            </span>
            <input
              ref={inputRef}
              type="text"
              value={instruction}
              onChange={(e) => handleInstructionChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRun()) {
                  e.preventDefault();
                  void run();
                }
              }}
              placeholder="e.g. Write a project summary, list key risks…"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30 focus-visible:ring-offset-2"
              autoFocus
            />
          </label>
        </div>
      )}

      {/* Loading state — inside the panel, not in the doc */}
      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          {/* Spinner via CSS animation — no new dependency */}
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
          Thinking…
        </div>
      )}

      {/* Result preview */}
      {!loading && markdown != null && (
        <>
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

          {/* Selective accept checklist — only when multiple top-level blocks */}
          {isMultiBlock && blocks.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Include in result
              </p>
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                {blocks.map((block, idx) => {
                  const excerpt =
                    blockExcerpt(block) || `[${block.type ?? "block"} ${idx + 1}]`;
                  return (
                    <label
                      key={idx}
                      className="flex items-start gap-2 rounded px-2 py-1 hover:bg-muted/60 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={checkedIndices.has(idx)}
                        onChange={() => {
                          setCheckedIndices((prev) => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx);
                            else next.add(idx);
                            return next;
                          });
                        }}
                        className="mt-0.5 shrink-0 accent-accent-coral"
                      />
                      <span className="text-sm text-foreground/80 truncate">
                        {excerpt}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={buttonClasses("secondary")}
        >
          Discard
        </button>

        {/* Re-run button: appears after a result when scope or instruction changed */}
        {showReRun && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun() || loading}
            className={buttonClasses("secondary")}
          >
            Re-run
          </button>
        )}

        {/* Initial Run button: only for "prompt" before the first run */}
        {showRunButton && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun()}
            className={buttonClasses("secondary")}
          >
            Run
          </button>
        )}

        {/* Insert below: only for replace-mode actions; keeps original, inserts AI result after */}
        {showInsertBelow && markdown != null && !loading && (
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
          disabled={noneChecked || !markdown || loading}
          className={buttonClasses("primary")}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
