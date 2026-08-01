// AiBar — streaming inline AI writing assistant.
//
// Replaces AiPanel. Lives inside AiCardHost (BlockPopover) or a Modal fallback.
// Drives the full lifecycle: idle (input + suggestions) → streaming (deltas
// applied into the document live) → result (Accept / Revert / follow-up).
//
// Key contracts:
//   - The client composes context INTO the instruction string before sending, so
//     history entries faithfully record what the model actually saw.
//   - replaceBlocks returns {insertedBlocks} — IDs come from insertedBlocks.map(b=>b.id).
//   - insertBlocks returns Block[] — IDs come from result.map(b=>b.id).
//   - tryParseMarkdownToBlocks is synchronous.
//   - The AI cursor plugin is registered while streaming and unregistered on stop/done.

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { buttonClasses } from "~/components/ui/Button";
import type { DocEditorInstance, DocPartialBlock } from "../schema/build";
import type { DialogApi } from "~/components/ui/dialog";
import {
  capMarkdown,
  CONTEXT_CHAR_CAP,
  getContinueContext,
  getDocumentScopeContext,
  getSelectionContext,
  isCursorBlockEmpty,
} from "./AiSlashMenuItems";
import { streamAi } from "./stream";
import { createStreamApplyEngine } from "./stream-apply";
import { createAiCursorPlugin, findBlockEndPos, aiCursorKey } from "./AiCursorPlugin";

// ── Config / Props ────────────────────────────────────────────────────────────

export interface AiBarConfig {
  origin: "slash" | "toolbar";
  cursorBlockId: string | null;
  selectionBlockIds: string[] | null;
}

export interface AiBarProps {
  editor: DocEditorInstance;
  config: AiBarConfig;
  onClose: () => void;
  toastInfo: (msg: string) => void;
  toastError: (msg: string) => void;
  /** Called when the "has result" state changes — lets AiCardHost decide
   *  whether to show a discard-confirm on outside click. */
  onHasResultChange?: (has: boolean) => void;
  /** Dialog API for the Escape→discard-confirm flow (result state). */
  dialog?: DialogApi;
}

export interface AiBarHandle {
  /** Stop a streaming run (keeps partial), or confirm-revert if in result phase. */
  handleEscape(): void;
  /** Confirm+revert+close — called by outside-click if hasResult. */
  revertAndClose(): Promise<void>;
  /** Whether there is a result (partial or complete) in the document. */
  hasResult: boolean;
}

// ── History helpers ───────────────────────────────────────────────────────────

type HistoryEntry = { role: "user" | "assistant"; content: string };
const HISTORY_CAP = 12; // max entries (must be even = 6 pairs)

/** Cap history to HISTORY_CAP by dropping the OLDEST pairs. */
function capHistory(entries: HistoryEntry[]): HistoryEntry[] {
  if (entries.length <= HISTORY_CAP) return entries;
  // Drop from the front in pairs.
  let drop = entries.length - HISTORY_CAP;
  if (drop % 2 !== 0) drop++; // always drop full pairs
  return entries.slice(drop);
}

// ── Template instruction builders ─────────────────────────────────────────────
//
// Exported for unit testing. Each builder returns the composed instruction string
// that will be sent to the server (context already embedded).

export type TemplateKey =
  | "continue"
  | "summarize"
  | "action-items"
  | "improve"
  | "fix-spelling"
  | "simplify";

export function buildTemplateInstruction(
  key: TemplateKey,
  context: string,
): string {
  const ctx = `\n\nContext (document excerpt):\n${context}`;
  switch (key) {
    case "continue":
      return `Continue writing from where the document leaves off. Return only the new content to append.${ctx}`;
    case "summarize":
      return `Write a concise summary of the document.${ctx}`;
    case "action-items":
      return `Extract the clear action items from the document as a markdown task list (- [ ] item).${ctx}`;
    case "improve":
      return `Improve the writing quality, clarity, and flow of the following text. Return only the improved version.${ctx}`;
    case "fix-spelling":
      return `Fix all spelling and grammar errors in the following text. Return only the corrected version.${ctx}`;
    case "simplify":
      return `Simplify the following text so it is easier to read. Return only the simplified version.${ctx}`;
  }
}

export function buildFreeTextInstruction(
  userText: string,
  context: string,
  origin: "slash" | "toolbar",
): string {
  if (origin === "slash") {
    return `${userText}\n\nContext (document excerpt):\n${context}`;
  }
  // toolbar: user wants to transform the selection
  return `${userText}\n\nApply this to the following text. Return only the resulting text.\n\nContext (document excerpt):\n${context}`;
}

// ── Phase state machine ───────────────────────────────────────────────────────

type Phase = "idle" | "streaming" | "result";

// ── Suggestion list ───────────────────────────────────────────────────────────

function AiIcon() {
  return (
    <span style={{ fontSize: 14, lineHeight: 1, userSelect: "none" }} aria-hidden>
      ✦
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AiBar = forwardRef<AiBarHandle, AiBarProps>(function AiBar(
  { editor, config, onClose, toastInfo, toastError, onHasResultChange, dialog },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [inputValue, setInputValue] = useState("");

  // Result state
  const [aiBlockIds, setAiBlockIds] = useState<string[]>([]);
  const [accumulated, setAccumulated] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // The first-turn instruction (with context) for history recording.
  const firstTurnInstructionRef = useRef<string>("");
  // Snapshot for Revert (only captured on first run).
  const originalSnapshotRef = useRef<DocPartialBlock[] | null>(null);
  // Whether any content has been written to the document (for hasResult).
  const hasContentRef = useRef(false);

  // Abort controller for the streaming fetch.
  const abortRef = useRef<AbortController | null>(null);

  // AI cursor plugin key for registration.
  const AI_CURSOR_EXT_KEY = "dali-ai-cursor-ext";

  // Derive "has result" = phase is streaming (with content) or result.
  const hasResult = phase === "result" || (phase === "streaming" && hasContentRef.current);

  const onHasResultChangeRef = useRef(onHasResultChange);
  onHasResultChangeRef.current = onHasResultChange;
  useEffect(() => {
    onHasResultChangeRef.current?.(hasResult);
  }, [hasResult]);

  // ── Cursor plugin management ─────────────────────────────────────────────

  function registerCursorPlugin() {
    editor.registerExtension({
      key: AI_CURSOR_EXT_KEY,
      prosemirrorPlugins: [createAiCursorPlugin()],
    });
  }

  function unregisterCursorPlugin() {
    editor.unregisterExtension(AI_CURSOR_EXT_KEY);
  }

  function updateCursorPos(blockIds: string[]) {
    if (!blockIds.length) return;
    const lastId = blockIds[blockIds.length - 1];
    const pos = findBlockEndPos(editor, lastId);
    if (pos < 0) return;
    const view = editor.prosemirrorView;
    if (!view) return;
    const tr = view.state.tr.setMeta(aiCursorKey, { pos });
    view.dispatch(tr);
  }

  // ── Snapshot capture ─────────────────────────────────────────────────────

  function captureSnapshot(selectionIds: string[]): DocPartialBlock[] | null {
    if (!selectionIds.length) return null;
    const allBlocks = editor.document;
    return selectionIds
      .map((id) => allBlocks.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => b != null) as DocPartialBlock[];
  }

  // ── Revert ───────────────────────────────────────────────────────────────

  const doRevert = useCallback(() => {
    const currentAiBlockIds = aiBlockIds;
    if (!currentAiBlockIds.length) return;

    const snapshot = originalSnapshotRef.current;
    const selectionIds = config.selectionBlockIds ?? [];
    const isReplaceMode = selectionIds.length > 0;

    try {
      if (isReplaceMode && snapshot && snapshot.length > 0) {
        editor.replaceBlocks(currentAiBlockIds, snapshot);
      } else {
        editor.removeBlocks(currentAiBlockIds.map((id) => ({ id })));
      }
    } catch {
      // Collab race — best-effort
    }
  }, [aiBlockIds, config.selectionBlockIds, editor]);

  // ── Stop stream ──────────────────────────────────────────────────────────

  const stopStream = useCallback((engineAccumulated: string, engineBlockIds: string[]) => {
    abortRef.current?.abort();
    abortRef.current = null;
    unregisterCursorPlugin();
    setAiBlockIds(engineBlockIds);
    setAccumulated(engineAccumulated);
    setPhase("result");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref for stopStream callback so engine closures can call it.
  const stopStreamRef = useRef(stopStream);
  stopStreamRef.current = stopStream;

  // ── Run (start streaming) ────────────────────────────────────────────────

  async function run(opts: {
    instruction: string;
    history: HistoryEntry[];
    selectionIds: string[];
    anchorId: string | null;
    isFirstRun: boolean;
  }) {
    const { instruction, history: runHistory, selectionIds, anchorId, isFirstRun } = opts;

    // Abort any existing stream.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture snapshot on first run only.
    if (isFirstRun) {
      originalSnapshotRef.current = captureSnapshot(selectionIds);
      firstTurnInstructionRef.current = instruction;
    }

    hasContentRef.current = false;
    setPhase("streaming");

    // Register cursor plugin.
    registerCursorPlugin();

    // Create the streaming apply engine.
    const engine = createStreamApplyEngine({
      editor,
      selectionIds: isFirstRun ? selectionIds : aiBlockIds, // follow-up replaces current AI blocks
      anchorId,
      toastError,
      onAiBlocksChange: (ids) => {
        hasContentRef.current = ids.length > 0;
        updateCursorPos(ids);
      },
      onEmpty: () => {
        toastInfo("AI returned nothing.");
        unregisterCursorPlugin();
        setPhase("idle");
      },
    });

    await streamAi({
      instruction,
      history: runHistory.length > 0 ? runHistory : undefined,
      signal: controller.signal,
      onDelta: (delta) => {
        engine.onDelta(delta);
      },
      onDone: () => {
        engine.onDone();
        if (!controller.signal.aborted) {
          unregisterCursorPlugin();
          setAiBlockIds(engine.aiBlockIds);
          setAccumulated(engine.accumulated);
          setPhase("result");
        }
      },
      onError: (msg) => {
        engine.finalize();
        unregisterCursorPlugin();
        if (!controller.signal.aborted) {
          toastError(msg);
          // If we already put content in the document, show result (so user can revert).
          if (engine.aiBlockIds.length > 0) {
            setAiBlockIds(engine.aiBlockIds);
            setAccumulated(engine.accumulated);
            setPhase("result");
          } else {
            setPhase("idle");
          }
        }
      },
    });
  }

  // ── Context builders ─────────────────────────────────────────────────────

  async function buildSelectionContext(): Promise<string> {
    const selIds = config.selectionBlockIds ?? [];
    if (!selIds.length) return "";
    const allBlocks = editor.document;
    const selBlocks = selIds
      .map((id) => allBlocks.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => b != null);
    if (!selBlocks.length) return "";
    const full = editor.blocksToMarkdownLossy(
      selBlocks as Parameters<typeof editor.blocksToMarkdownLossy>[0],
    );
    return capMarkdown(full, CONTEXT_CHAR_CAP);
  }

  // ── Suggestion handlers ──────────────────────────────────────────────────

  async function runTemplate(key: TemplateKey) {
    const selectionIds = config.selectionBlockIds ?? [];
    const isReplaceMode = selectionIds.length > 0;

    let context: string;
    let anchorId: string | null = config.cursorBlockId;

    if (key === "continue") {
      context = await getContinueContext(editor);
      anchorId = config.cursorBlockId;
    } else if (isReplaceMode && (key === "improve" || key === "fix-spelling" || key === "simplify")) {
      context = await buildSelectionContext();
      anchorId = selectionIds[selectionIds.length - 1];
    } else {
      const { markdown } = await getDocumentScopeContext(editor);
      context = markdown;
    }

    const instruction = buildTemplateInstruction(key, context);

    await run({
      instruction,
      history: [],
      selectionIds: isReplaceMode && key !== "continue" && key !== "summarize" && key !== "action-items"
        ? selectionIds
        : [],
      anchorId,
      isFirstRun: true,
    });
  }

  async function runFreeText(text: string) {
    const selectionIds = config.selectionBlockIds ?? [];
    const isReplaceMode = selectionIds.length > 0;

    let context: string;
    let anchorId: string | null = config.cursorBlockId;

    if (isReplaceMode) {
      context = await buildSelectionContext();
      anchorId = selectionIds[selectionIds.length - 1];
    } else {
      const { markdown } = await getDocumentScopeContext(editor);
      context = markdown;
    }

    const instruction = buildFreeTextInstruction(text, context, config.origin);

    await run({
      instruction,
      history: [],
      selectionIds: isReplaceMode ? selectionIds : [],
      anchorId,
      isFirstRun: true,
    });
  }

  async function runFollowUp(text: string) {
    // Build history: first turn + any previous follow-ups.
    const newHistory = capHistory([
      ...history,
      { role: "user" as const, content: firstTurnInstructionRef.current },
      { role: "assistant" as const, content: accumulated },
    ]);

    setHistory(newHistory);
    setInputValue("");

    // Follow-ups replace the current AI blocks.
    await run({
      instruction: text,
      history: newHistory,
      selectionIds: aiBlockIds, // always replace existing AI blocks
      anchorId: null,
      isFirstRun: false,
    });
  }

  // ── Accept ───────────────────────────────────────────────────────────────

  function handleAccept() {
    // AI blocks are already in the document. Just clear state and close.
    originalSnapshotRef.current = null;
    onClose();
  }

  // ── Revert and close ─────────────────────────────────────────────────────

  const handleRevertAndClose = useCallback(async () => {
    doRevert();
    onClose();
  }, [doRevert, onClose]);

  // ── Escape ───────────────────────────────────────────────────────────────

  const handleEscape = useCallback(async () => {
    if (phase === "streaming") {
      // Stop the stream; keep partial content; move to result.
      abortRef.current?.abort();
      abortRef.current = null;
      unregisterCursorPlugin();
      // Phase will have been set by onDone/onError callbacks; force result if still streaming.
      setPhase((p) => (p === "streaming" ? "result" : p));
    } else if (phase === "result") {
      // Confirm before discarding.
      if (dialog) {
        const confirmed = await dialog.confirm({
          title: "Discard AI response?",
          confirmLabel: "Discard",
          cancelLabel: "Keep open",
        });
        if (confirmed) {
          await handleRevertAndClose();
        }
      } else {
        // No dialog — just close (unlikely in practice).
        await handleRevertAndClose();
      }
    } else {
      // Idle — just close.
      onClose();
    }
  }, [phase, dialog, handleRevertAndClose, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imperative handle (used by AiCardHost for Escape + outside-click) ───

  useImperativeHandle(
    ref,
    () => ({
      handleEscape,
      revertAndClose: handleRevertAndClose,
      get hasResult() {
        return hasResult;
      },
    }),
    [handleEscape, handleRevertAndClose, hasResult],
  );

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      editor.unregisterExtension(AI_CURSOR_EXT_KEY);
    };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autofocus input in idle ──────────────────────────────────────────────

  useEffect(() => {
    if (phase === "idle") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [phase]);

  // ── Suggestion list based on origin ──────────────────────────────────────

  const isSelection = (config.selectionBlockIds?.length ?? 0) > 0;

  const suggestions: { label: string; action: () => void }[] = isSelection
    ? [
        { label: "Improve Writing", action: () => void runTemplate("improve") },
        { label: "Fix Spelling & Grammar", action: () => void runTemplate("fix-spelling") },
        {
          label: "Translate…",
          action: () => {
            setInputValue("Translate into ");
            setTimeout(() => {
              const inp = inputRef.current;
              if (inp) {
                inp.focus();
                inp.setSelectionRange(inp.value.length, inp.value.length);
              }
            }, 0);
          },
        },
        { label: "Simplify", action: () => void runTemplate("simplify") },
      ]
    : [
        { label: "Continue Writing", action: () => void runTemplate("continue") },
        { label: "Summarize", action: () => void runTemplate("summarize") },
        { label: "Add Action Items", action: () => void runTemplate("action-items") },
        {
          label: "Write Anything…",
          action: () => {
            setTimeout(() => inputRef.current?.focus(), 0);
          },
        },
      ];

  // ── Render ───────────────────────────────────────────────────────────────

  const isIdle = phase === "idle";
  const isStreaming = phase === "streaming";
  const isResult = phase === "result";

  const inputPlaceholder = isResult
    ? "Respond to edit…"
    : isSelection
      ? "Ask AI to transform selection…"
      : "Ask AI to write or edit…";

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text) return;
      if (isResult) {
        void runFollowUp(text);
      } else if (isIdle) {
        void runFreeText(text);
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void handleEscape();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header row: sparkle icon + status */}
      <div className="flex items-center gap-2">
        <span className="text-accent-coral" aria-hidden>
          ✦
        </span>
        <span className="text-sm font-medium text-foreground">
          {isStreaming ? "Writing…" : isResult ? "Review AI response" : "AI Writing Assistant"}
        </span>
        {isStreaming && (
          <span
            className="ml-auto inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground"
            aria-hidden
          />
        )}
      </div>

      {/* Suggestion chips — only in idle */}
      {isIdle && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={s.action}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
            >
              <AiIcon />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={inputPlaceholder}
          disabled={isStreaming}
          className="flex-1 min-w-0 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30 focus-visible:ring-offset-2 disabled:opacity-50"
          autoFocus
        />
        {isIdle && inputValue.trim() && (
          <button
            type="button"
            onClick={() => void runFreeText(inputValue.trim())}
            className={buttonClasses("primary", "sm")}
          >
            Run
          </button>
        )}
        {isResult && inputValue.trim() && (
          <button
            type="button"
            onClick={() => void runFollowUp(inputValue.trim())}
            className={buttonClasses("secondary", "sm")}
          >
            Send
          </button>
        )}
      </div>

      {/* Footer buttons — result or streaming */}
      {(isResult || isStreaming) && (
        <div className="flex items-center justify-end gap-2">
          {isStreaming && (
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort();
                abortRef.current = null;
                unregisterCursorPlugin();
                setPhase("result");
              }}
              className={buttonClasses("secondary", "sm")}
            >
              Stop
            </button>
          )}
          {isResult && (
            <>
              <button
                type="button"
                onClick={() => void handleRevertAndClose()}
                className={buttonClasses("secondary", "sm")}
              >
                Revert
              </button>
              <button
                type="button"
                onClick={handleAccept}
                className={buttonClasses("primary", "sm")}
              >
                Accept
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});
