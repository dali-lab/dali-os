import type { ReactNode } from "react";
import { MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Menu, MenuItem } from "~/components/ui/floating";
import { deriveRailState } from "./RecordingRail";
import { ProcessingWaveform } from "./ProcessingWaveform";
import { describeProcessing } from "./processing-progress";
import { speakerLabelFor } from "./transcript";
import type { UseMeetingRecording } from "./use-meeting-recording";
import type { Channel } from "./types";

export const ENHANCE_AGAIN_TIP = "Rebuilds the notes from the current text and the transcript.";
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
    <div role="region" aria-label="Recording progress" className="border-b border-os-accent/20 bg-os-accent/5 px-4 py-2.5 sm:px-7">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {icon && <span className="text-os-accent">{icon}</span>}
        <div aria-live="polite" className="flex min-w-[170px] flex-col">
          <span className="text-sm font-bold text-foreground">{title}</span>
          {detail && <span className="text-[12.5px] tabular-nums text-muted-foreground">{detail}</span>}
        </div>
        {middle}
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </div>
      {note && <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">{note}</div>}
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

/**
 * The lifecycle bar under the notebook tabs (specs/enhance-progress-and-
 * review-motion.md section 3): processing, ready, enhancing, and the pending
 * review's Keep all / Revert all. Renders nothing for every other state.
 */
export function EnhanceBar({ rec }: { rec: UseMeetingRecording }) {
  const state = deriveRailState(rec);
  const owner = rec.remote ? ` · ${rec.remote.ownerIsYou ? "another device" : rec.remote.ownerName}` : "";

  switch (state) {
    case "processing": {
      const d = describeProcessing(rec.processingStage ?? "starting", rec.progress);
      return (
        <BarShell
          title={d.title}
          detail={`${d.detail}${owner}`}
          middle={<ProcessingWaveform stage={rec.processingStage ?? "starting"} fraction={d.fraction} />}
          actions={
            rec.canDiscard ? (
              <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
            ) : null
          }
        />
      );
    }

    case "ready":
    case "inserted": {
      if (!rec.canEdit) return null;
      if (state === "inserted" && !rec.aiEnabled) return null;
      const names = speakerNamesFor(rec);
      const minutes = Math.max(1, Math.round(rec.recordedSeconds / 60));
      const detail = `${minutes} min${names.length > 0 ? ` · ${plural(names.length, "speaker")}` : ""}${owner}`;
      const label = !rec.aiEnabled ? "Insert transcript" : state === "ready" && rec.currentlyUntouched() ? "Write notes" : "Enhance notes";
      return (
        <BarShell
          title={state === "inserted" ? "Transcript inserted" : "Transcript ready"}
          detail={detail}
          middle={
            names.length > 0 ? (
              <span className="flex items-center" aria-hidden>
                {names.slice(0, MAX_AVATARS).map((name, i) => (
                  <Avatar key={i} name={name} size="xs" className={i === 0 ? "ring-2 ring-card" : "-ml-1.5 ring-2 ring-card"} />
                ))}
              </span>
            ) : null
          }
          actions={
            <>
              {rec.aiEnabled && state === "ready" && (
                <button type="button" onClick={() => rec.insert(null)} disabled={rec.busy} className={buttonClasses("ghost", "sm")}>
                  Insert transcript
                </button>
              )}
              <button
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
      );
    }

    case "generating":
      return (
        <BarShell
          title="Enhancing"
          detail="Reading your notes and the transcript"
          actions={ghost(rec.cancelEnhanceGenerating, "Cancel")}
        />
      );

    case "pendingReview": {
      const n = rec.pendingMarks.length;
      return (
        <BarShell
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          title={`${plural(n, "suggestion")} from the transcript`}
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
                <Menu
                  align="right"
                  ariaLabel="More"
                  trigger={<IconButton label="More" icon={MoreHorizontal} />}
                >
                  <MenuItem onSelect={() => void rec.revertAllAndEnhanceAgain()} label="Enhance again">
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
              </>
            ) : null
          }
          note={<ReviewNotes rec={rec} />}
        />
      );
    }

    case "stalePreview":
      return (
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
      );

    default:
      return null;
  }
}
