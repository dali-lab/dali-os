// AiBar — streaming inline AI writing assistant.
//
// Replaces AiPanel. Lives inside AiCardHost (BlockPopover) or a Modal fallback.
// Drives the full lifecycle: idle (input + suggestions) → streaming (compact
// status strip) → result (Accept / Revert / follow-up).
//
// Key contracts:
//   - The client composes context INTO the instruction string before sending, so
//     history entries faithfully record what the model actually saw.
//   - replaceBlocks returns {insertedBlocks} — IDs come from insertedBlocks.map(b=>b.id).
//   - insertBlocks returns Block[] — IDs come from result.map(b=>b.id).
//   - tryParseMarkdownToBlocks is synchronous.
//   - The AI cursor plugin stays registered through result phase (highlight persists);
//     unregistered only on Accept, Revert, or unmount.

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import {
  PenLine,
  ListChecks,
  Languages,
  CornerDownLeft,
  Undo2,
  WandSparkles,
  Check,
  Minimize2,
  AlignLeft,
} from "lucide-react";
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
import {
  createAiCursorPlugin,
  findBlockEndPos,
  aiCursorKey,
  updateAiPluginState,
} from "./AiCursorPlugin";
import { AiSparkleIcon } from "./AiSparkleIcon";

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
  /** Called when the anchor block changes during streaming (dynamic anchor). */
  onAnchorChange?: (blockId: string) => void;
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

// ── Suggestion type ───────────────────────────────────────────────────────────

type SuggestionEntry = {
  label: string;
  action: () => void;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

// ── Component ─────────────────────────────────────────────────────────────────

export const AiBar = forwardRef<AiBarHandle, AiBarProps>(function AiBar(
  { editor, config, onClose, toastInfo, toastError, onHasResultChange, dialog, onAnchorChange },
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
    const view = editor.prosemirrorView;
    if (!view) return;
    // Update both cursor position and pending block highlight set.
    updateAiPluginState(view, {
      ...(pos >= 0 ? { pos } : {}),
      pendingBlockIds: blockIds,
    });
    // Notify parent of the new anchor block for dynamic card positioning.
    if (blockIds.length > 0) {
      onAnchorChange?.(blockIds[blockIds.length - 1]);
    }
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
    // Keep plugin registered — highlight persists into result phase.
    // Just clear the caret pos.
    const view = editor.prosemirrorView;
    if (view) {
      updateAiPluginState(view, { pos: -1 });
    }
    setAiBlockIds(engineBlockIds);
    setAccumulated(engineAccumulated);
    setPhase("result");
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

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
          // Keep plugin registered — highlight persists. Just clear the caret.
          const view = editor.prosemirrorView;
          if (view) {
            updateAiPluginState(view, { pos: -1 });
          }
          setAiBlockIds(engine.aiBlockIds);
          setAccumulated(engine.accumulated);
          setPhase("result");
        }
      },
      onError: (msg) => {
        engine.finalize();
        if (!controller.signal.aborted) {
          // On error with no content: unregister immediately.
          if (engine.aiBlockIds.length === 0) {
            unregisterCursorPlugin();
            toastError(msg);
            setPhase("idle");
          } else {
            // Has partial content: keep highlight, clear caret, show result.
            const view = editor.prosemirrorView;
            if (view) {
              updateAiPluginState(view, { pos: -1 });
            }
            toastError(msg);
            setAiBlockIds(engine.aiBlockIds);
            setAccumulated(engine.accumulated);
            setPhase("result");
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
    unregisterCursorPlugin();
    originalSnapshotRef.current = null;
    onClose();
  }

  // ── Revert and close ─────────────────────────────────────────────────────

  const handleRevertAndClose = useCallback(async () => {
    unregisterCursorPlugin();
    doRevert();
    onClose();
  }, [doRevert, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Escape ───────────────────────────────────────────────────────────────

  const handleEscape = useCallback(async () => {
    if (phase === "streaming") {
      // Stop the stream; keep partial content + highlight; clear caret; move to result.
      abortRef.current?.abort();
      abortRef.current = null;
      const view = editor.prosemirrorView;
      if (view) {
        updateAiPluginState(view, { pos: -1 });
      }
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
  }, [phase, dialog, handleRevertAndClose, onClose, editor]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const suggestions: SuggestionEntry[] = isSelection
    ? [
        { label: "Improve Writing", action: () => void runTemplate("improve"), Icon: WandSparkles },
        { label: "Fix Spelling & Grammar", action: () => void runTemplate("fix-spelling"), Icon: Check },
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
          Icon: Languages,
        },
        { label: "Simplify", action: () => void runTemplate("simplify"), Icon: Minimize2 },
      ]
    : [
        { label: "Continue Writing", action: () => void runTemplate("continue"), Icon: PenLine },
        { label: "Summarize", action: () => void runTemplate("summarize"), Icon: AlignLeft },
        { label: "Add Action Items", action: () => void runTemplate("action-items"), Icon: ListChecks },
        {
          label: "Write Anything…",
          action: () => {
            setTimeout(() => inputRef.current?.focus(), 0);
          },
          Icon: PenLine,
        },
      ];

  // ── Render ───────────────────────────────────────────────────────────────

  const isIdle = phase === "idle";
  const isStreaming = phase === "streaming";
  const isResult = phase === "result";

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

  // ── Streaming: compact status strip ─────────────────────────────────────

  if (isStreaming) {
    return (
      <div className="flex items-center gap-2 px-1">
        <AiSparkleIcon size={14} className="text-violet-500 shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">Editing…</span>
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            abortRef.current = null;
            const view = editor.prosemirrorView;
            if (view) {
              updateAiPluginState(view, { pos: -1 });
            }
            setPhase("result");
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded"
        >
          Stop
        </button>
      </div>
    );
  }

  // ── Idle / Result: two-card stack ────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1.5">
      {/* Card 1: Input */}
      <div className="flex items-center gap-2 bg-card border border-border rounded-xl shadow-sm px-4 py-3">
        <AiSparkleIcon size={16} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={
            isResult
              ? "Respond to the edit…"
              : isSelection
                ? "Ask AI to transform selection…"
                : "Ask AI anything…"
          }
          className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoFocus
        />
        {inputValue.trim() && (
          <button
            type="button"
            onClick={() =>
              isResult ? void runFollowUp(inputValue.trim()) : void runFreeText(inputValue.trim())
            }
            className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
            aria-label="Submit"
          >
            <CornerDownLeft size={12} />
          </button>
        )}
      </div>

      {/* Card 2: suggestions (idle) or accept/revert (result) */}
      {(isIdle || isResult) && (
        <div className="self-start min-w-[200px] bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          {isResult ? (
            <>
              <button
                type="button"
                onClick={handleAccept}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Check size={14} className="text-green-600 shrink-0" />
                Accept
              </button>
              <button
                type="button"
                onClick={() => void handleRevertAndClose()}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Undo2 size={14} className="text-muted-foreground shrink-0" />
                Revert
              </button>
            </>
          ) : (
            suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={s.action}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <s.Icon size={14} className="text-muted-foreground shrink-0" />
                {s.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});
