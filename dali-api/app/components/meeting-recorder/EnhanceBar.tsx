import { useRef, type ReactNode } from "react";
import { ListChecks, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { enhanceWasUndone, useActionItemDraft, type ActionItemDraft } from "./action-item-draft";
import { BAR_ATTR } from "./block-dom";
import { BarTransition, type BarContent } from "./BarTransition";
import { DUR, enterRef } from "./motion";
import { PopIn } from "./PopIn";
import { deriveRailState, ENHANCE_AGAIN_TIP } from "./RecordingRail";
import { ProcessingWaveform } from "./ProcessingWaveform";
import { describeProcessing } from "./processing-progress";
import { speakerLabelFor } from "./transcript";
import type { UseMeetingRecording } from "./use-meeting-recording";
import type { Channel } from "./types";

const RISE_IN = enterRef([{ opacity: 0, transform: `translateY(${DUR.swapRisePx}px)` }, { opacity: 1, transform: "none" }], DUR.enhanceButton, {
  delay: DUR.enhanceButtonDelay,
});

const MAX_AVATARS = 5;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function speakerNamesFor(rec: UseMeetingRecording): string[] {
  const counts = { mic: 0, call: 0 } as Record<Channel, number>;
  for (const key of rec.speakerKeys) counts[key.startsWith("call") ? "call" : "mic"]++;
  return rec.speakerKeys.map((key) =>
    speakerLabelFor({ channel: key.startsWith("call") ? "call" : "mic", speaker: key }, counts, rec.speakers, rec.roster, rec.speakerNames),
  );
}

function BarShell({
  icon,
  title,
  detail,
  middle,
  actions,
  note,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  middle?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div role="region" aria-label="Recording progress" {...{ [BAR_ATTR]: "" }} className="border-b border-os-accent/20 bg-os-accent/5 px-4 py-2.5 sm:px-7">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {icon && <span className="text-os-accent">{icon}</span>}
        <div aria-live="polite" className="flex min-w-[170px] flex-col">
          <span className="text-sm font-bold text-foreground">{title}</span>
          {detail && <span className="text-[12.5px] tabular-nums text-muted-foreground">{detail}</span>}
        </div>
        {middle}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </div>
      {note && <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground empty:hidden">{note}</div>}
    </div>
  );
}

function ghost(onClick: () => void, label: string) {
  return (
    <button type="button" onClick={onClick} className={buttonClasses("ghost", "sm")}>
      {label}
    </button>
  );
}

function BarMenu({ rec, enhanceAgain }: { rec: UseMeetingRecording; enhanceAgain: () => void }) {
  if (!rec.canEdit) return null;
  return (
    <Menu align="right" ariaLabel="More" trigger={<IconButton label="More" icon={MoreHorizontal} />}>
      <MenuItem onSelect={enhanceAgain} label="Enhance again">
        <span className="flex flex-col text-left">
          <span>Enhance again</span>
          <span className="max-w-56 text-xs text-muted-foreground">{ENHANCE_AGAIN_TIP}</span>
        </span>
      </MenuItem>
      {rec.canDiscard && (
        <MenuItem destructive onSelect={() => void rec.discard()}>
          Discard recording
        </MenuItem>
      )}
    </Menu>
  );
}

function EnhanceErrorNote({ rec }: { rec: UseMeetingRecording }) {
  return rec.enhanceError ? <p>{rec.enhanceError}</p> : null;
}

function taskHref(draft: ActionItemDraft, taskId: string): string {
  return `/projects/${draft.projectId}?tab=progress&task=${taskId}`;
}

function OrphanedTasksNote({ draft }: { draft: ActionItemDraft }) {
  const { orphanedTasks } = draft;
  if (orphanedTasks.length === 0 || !draft.projectId) return null;
  return (
    <p>
      {orphanedTasks.length === 1 ? "1 task's line was removed" : `${orphanedTasks.length} tasks' lines were removed`}
      {orphanedTasks.map((item) => (
        <span key={item.taskId}>
          {" · "}
          <Link to={taskHref(draft, item.taskId!)} className="font-medium text-os-accent hover:underline">
            View task{orphanedTasks.length > 1 ? `: ${item.text}` : ""}
          </Link>
        </span>
      ))}
    </p>
  );
}

function tasksBar(rec: UseMeetingRecording, draft: ActionItemDraft | null): BarContent {
  if (!draft) return null;

  const board = "the project board";

  if (draft.created !== null && !draft.stepVisible) {
    return {
      key: "tasks-created",
      node: (
        <BarShell
          icon={<ListChecks className="h-4 w-4" aria-hidden />}
          title={`Added ${plural(draft.created, "task")} to ${board}`}
          actions={
            draft.projectId ? (
              <Link to={`/projects/${draft.projectId}?tab=progress`} className={buttonClasses("ghost", "sm")}>
                View board
              </Link>
            ) : null
          }
          note={<OrphanedTasksNote draft={draft} />}
        />
      ),
    };
  }

  if (!draft.stepVisible) {
    if (draft.orphanedTasks.length === 0 || !draft.projectId) return null;
    return {
      key: "tasks-orphaned",
      node: <BarShell icon={<ListChecks className="h-4 w-4" aria-hidden />} title="Tasks from this meeting" note={<OrphanedTasksNote draft={draft} />} />,
    };
  }

  const unmatched =
    draft.unmatchedCount > 0
      ? ` ${draft.unmatchedCount === 1 ? "1 owner needs a pick." : `${draft.unmatchedCount} owners need a pick.`}`
      : "";

  return {
    key: "tasks",
    node: (
      <BarShell
        icon={<ListChecks className="h-4 w-4" aria-hidden />}
        title={plural(draft.untaskedCount, "action item")}
        middle={
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
            Check owners and dates, then add them to {board}.{unmatched}
          </p>
        }
        actions={
          <>
            {ghost(draft.dismiss, "Not now")}
            <button
              type="button"
              onClick={() => void draft.create()}
              disabled={draft.busy || draft.checkedCount === 0}
              className={buttonClasses("primary", "sm")}
            >
              {draft.busy ? "Creating…" : `Create ${plural(draft.checkedCount, "task")}`}
            </button>
            <BarMenu rec={rec} enhanceAgain={() => void rec.enhanceNow()} />
          </>
        }
        note={
          <>
            {draft.created !== null && <p>Added {plural(draft.created, "task")} to {board}</p>}
            <OrphanedTasksNote draft={draft} />
            <EnhanceErrorNote rec={rec} />
          </>
        }
      />
    ),
  };
}

function ReviewTitle({ rec }: { rec: UseMeetingRecording }) {
  const last = useRef<string | null>(null);
  const text = `${plural(rec.pendingMarks.length, "suggestion")} from the transcript`;
  function jump() {
    const order = (rec.getNoteState?.()?.blocks ?? []).map((b) => b.id);
    const ids = rec.pendingMarks.map((m) => m.id);
    const sorted = order.length > 0 ? [...ids].sort((a, b) => rank(order, a) - rank(order, b)) : ids;
    if (sorted.length === 0) return;
    const at = last.current ? sorted.indexOf(last.current) : -1;
    const next = sorted[(at + 1) % sorted.length]!;
    last.current = next;
    rec.scrollToBlock(next);
  }
  return (
    <button type="button" onClick={jump} className="text-left text-sm font-bold text-foreground hover:underline">
      {text}
    </button>
  );
}

function rank(order: string[], id: string): number {
  const at = order.indexOf(id);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

function ReviewNotes({ rec }: { rec: UseMeetingRecording }) {
  const verified = rec.enhanceNotes?.verified;
  const lines: string[] = [];
  if (verified && verified.droppedBlocks > 0) {
    lines.push(
      `${plural(verified.droppedBlocks, "addition")} couldn't be verified against the transcript and ${verified.droppedBlocks === 1 ? "was" : "were"} left out.`,
    );
  }
  if (verified && verified.droppedCites > 0) {
    lines.push(`${plural(verified.droppedCites, "citation")} didn't match the transcript and ${verified.droppedCites === 1 ? "was" : "were"} dropped.`);
  }
  if (rec.enhanceSkipped > 0) {
    lines.push(`${plural(rec.enhanceSkipped, "block")} changed while this ran and ${rec.enhanceSkipped === 1 ? "was" : "were"} left as typed.`);
  }
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

function readyBar(rec: UseMeetingRecording, state: "ready" | "inserted", celebrate: boolean, owner: string): BarContent {
  if (!rec.canEdit) return null;
  if (state === "inserted" && !rec.aiEnabled) return null;
  const names = speakerNamesFor(rec);
  const minutes = Math.max(1, Math.round(rec.recordedSeconds / 60));
  const detail = `${minutes} min${names.length > 0 ? ` · ${plural(names.length, "speaker")}` : ""}${owner}`;
  const label = !rec.aiEnabled ? "Insert transcript" : state === "ready" && rec.currentlyUntouched() ? "Write notes" : "Enhance notes";
  const showWave = celebrate && state === "ready";
  return {
    key: state,
    node: (
      <BarShell
        title={state === "inserted" ? "Transcript inserted" : "Transcript ready"}
        detail={detail}
        middle={
          <>
            {showWave && (
              <ProcessingWaveform stage="ready" fraction={1} lines={rec.sortedLines} totalSeconds={rec.recordedSeconds} />
            )}
            {names.length > 0 ? (
              <span className="flex items-center" aria-hidden>
                {names.slice(0, MAX_AVATARS).map((name, i) => (
                  <PopIn key={i} from={0.6} ms={DUR.avatar} delay={i * DUR.avatarStagger} enabled={celebrate} className={i === 0 ? "" : "-ml-1.5"}>
                    <Avatar name={name} size="compact" className="ring-2 ring-background" />
                  </PopIn>
                ))}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {rec.aiEnabled && state === "ready" && (
              <button type="button" onClick={() => rec.insert(null)} disabled={rec.busy} className={buttonClasses("ghost", "sm")}>
                Insert transcript
              </button>
            )}
            <button
              ref={celebrate ? RISE_IN : undefined}
              type="button"
              onClick={!rec.aiEnabled ? () => rec.insert(null) : () => void rec.enhanceNow()}
              disabled={!rec.hasTranscript || rec.busy}
              className={buttonClasses("primary", "sm")}
            >
              {label}
            </button>
          </>
        }
      />
    ),
  };
}

/**
 * The lifecycle bar under the notebook tabs (specs/enhance-progress-and-
 * review-motion.md section 3): processing, ready, enhancing, and the pending
 * review's Keep all / Revert all, and the tasks step. Renders nothing for
 * every other state.
 */
export function EnhanceBar({ rec }: { rec: UseMeetingRecording }) {
  const state = deriveRailState(rec);
  const draft = useActionItemDraft();
  const cameFromProcessing = useRef(false);
  if (state === "processing") cameFromProcessing.current = true;
  else if (state !== "ready") cameFromProcessing.current = false;
  return <BarTransition content={barContent(rec, state, draft, cameFromProcessing.current)} />;
}

function barContent(
  rec: UseMeetingRecording,
  state: ReturnType<typeof deriveRailState>,
  draft: ActionItemDraft | null,
  celebrate: boolean,
): BarContent {
  const owner = rec.remote ? ` · ${rec.remote.ownerIsYou ? "another device" : rec.remote.ownerName}` : "";

  switch (state) {
    case "processing": {
      const d = describeProcessing(rec.processingStage ?? "starting", rec.progress);
      return {
        key: "processing",
        node: (
          <BarShell
            title={d.title}
            detail={d.detail}
            middle={<ProcessingWaveform stage={rec.processingStage ?? "starting"} fraction={d.fraction} />}
            actions={
              rec.canDiscard ? (
                <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
              ) : null
            }
          />
        ),
      };
    }

    case "failed":
      return {
        key: "failed",
        node: (
          <BarShell
            title="Transcription failed"
            middle={<p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{rec.error ?? "Something went wrong while transcribing."}</p>}
            actions={
              rec.canEdit ? (
                <>
                  {rec.canDiscard && (
                    <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
                  )}
                  {rec.drives && !rec.finalized && (
                    <button type="button" onClick={() => void rec.retryProcessing()} className={buttonClasses("primary", "sm")}>
                      Try again
                    </button>
                  )}
                </>
              ) : null
            }
          />
        ),
      };

    case "enhanced":
      if (!enhanceWasUndone(rec)) return tasksBar(rec, draft);
      return readyBar(rec, "ready", celebrate, owner);

    case "noSpeech":
      return {
        key: "noSpeech",
        node: <BarShell title="No speech was captured" detail="Nothing was transcribed from this recording. Discard it and record again." />,
      };

    case "ready":
    case "inserted":
      return readyBar(rec, state, celebrate, owner);

    case "generating":
      return {
        key: "generating",
        node: (
          <BarShell
            title={
              <>
                Enhancing
                <span aria-hidden className="ml-1 inline-flex gap-0.5 align-middle">
                  {[0, 1, 2].map((i) => (
                    <i
                      key={i}
                      data-dot
                      style={{ animation: "enhance-dot-pulse 1.2s ease-in-out infinite", animationDelay: `${i * 160}ms` }}
                      className="inline-block h-1 w-1 rounded-full bg-current motion-reduce:[animation:none]"
                    />
                  ))}
                </span>
              </>
            }
            detail="Reading your notes and the transcript"
            actions={ghost(rec.cancelEnhanceGenerating, "Cancel")}
            note={<EnhanceErrorNote rec={rec} />}
          />
        ),
      };

    case "pendingReview": {
      return {
        key: "review",
        node: (
          <BarShell
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
            title={<ReviewTitle rec={rec} />}
            middle={
              rec.canEdit ? (
                <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">Edit any line to keep it. Your own lines stay as typed.</p>
              ) : null
            }
            actions={
              rec.canEdit ? (
                <>
                  {ghost(() => rec.revertAll(), "Revert all")}
                  <button type="button" onClick={() => rec.keepAll()} className={buttonClasses("primary", "sm")}>
                    Keep all
                  </button>
                  <BarMenu rec={rec} enhanceAgain={() => void rec.revertAllAndEnhanceAgain()} />
                </>
              ) : null
            }
            note={
              <>
                <ReviewNotes rec={rec} />
                <EnhanceErrorNote rec={rec} />
              </>
            }
          />
        ),
      };
    }

    case "stalePreview":
      return {
        key: "stale",
        node: (
          <BarShell
            title="Someone enhanced this note after your preview."
            actions={
              <>
                {ghost(rec.dismissStalePreview, "Cancel")}
                <button type="button" onClick={rec.reloadStalePreview} className={buttonClasses("primary", "sm")}>
                  Reload preview
                </button>
              </>
            }
          />
        ),
      };

    default:
      return null;
  }
}
