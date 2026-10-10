import { useEffect, useRef, type ReactNode } from "react";
import { Download, Mic, Square, Trash2, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { formatClock } from "./transcript";
import { formatDateTime } from "./use-meeting-recording";
import type { UseMeetingRecording } from "./use-meeting-recording";
import type { Channel } from "./types";
import { computeEnhancePreview, EnhancePreview } from "./EnhancePreview";
import { RecordingTranscript } from "./RecordingTranscript";

/** Stable id for the rail's own `<h2>` — ui/Drawer's narrow-canvas
 *  rendering passes this as `labelledBy` instead of rendering a second
 *  header on top of the rail's own. Safe as a fixed string: the wide sticky
 *  column and the narrow Drawer are never both mounted at once. */
export const RECORDING_RAIL_TITLE_ID = "recording-rail-title";

export type RailState =
  | "starting"
  | "recording"
  | "stopping"
  | "review"
  | "processing"
  | "failed"
  | "ready"
  | "generating"
  | "preview"
  | "enhanced"
  | "inserted"
  | "stalePreview";

/** Maps the hook's phase + Enhance flags onto the named state in
 *  specs/meeting-recording-rail.md's state table. Null while idle — there's
 *  no rail body for the start sheet. */
export function deriveRailState(
  rec: Pick<UseMeetingRecording, "phase" | "insertedAt" | "stalePreview" | "enhanceSheetOpen" | "enhanceNotes" | "enhancedAt">,
): RailState | null {
  if (rec.phase === "idle") return null;
  if (rec.phase !== "done") return rec.phase;
  if (rec.insertedAt) return "inserted";
  if (rec.stalePreview) return "stalePreview";
  if (rec.enhanceSheetOpen) return rec.enhanceNotes ? "preview" : "generating";
  if (rec.enhancedAt) return "enhanced";
  return "ready";
}

/**
 * The Recording rail (specs/meeting-recording-rail.md): one surface for
 * every state after Start. Wide canvas renders this sticky beside the
 * document; narrow canvas renders it inside ui/Drawer for every state except
 * the live ones. Purely presentational — `rec` carries all the state and
 * callbacks.
 */
export function RecordingRail({ rec }: { rec: UseMeetingRecording }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headerRef.current?.focus({ preventScroll: true });
  }, []);

  // The rail isn't a dialog (no focus trap), but Escape while focus is
  // inside it still closes it — e.g. after a citation chip moved focus to
  // the highlighted line (specs/meeting-recording-rail.md "Accessibility").
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      rec.setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rec]);

  const state = deriveRailState(rec);
  if (!state) return null;

  const following = Boolean(rec.remote && !rec.remote.ownerIsYou);
  const title = following ? `Recording · ${rec.remote!.ownerName}` : "Recording";

  return (
    <div ref={rootRef} role="complementary" aria-label="Recording" className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id={RECORDING_RAIL_TITLE_ID} ref={headerRef} tabIndex={-1} className="text-sm font-bold text-foreground outline-none">
            {title}
          </h2>
          <IconButton label="Close" icon={X} onClick={() => rec.setOpen(false)} />
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {statusLineFor(rec, state)}
        </p>
        <RailActions rec={rec} state={state} />
      </div>
      <RailBody rec={rec} state={state} />
      {rec.hasTranscript && <RecordingTranscript rec={rec} />}
    </div>
  );
}

/** Exported for the top-bar narrow-canvas live Popover, which shows the same
 *  status line text beside its own meters + Stop. */
export function statusLineFor(rec: UseMeetingRecording, state: RailState): ReactNode {
  if (state === "recording") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        {formatClock(rec.elapsed)}
        {rec.remote && (
          <span className="text-muted-foreground">· {rec.remote.ownerIsYou ? "another device" : rec.remote.ownerName}</span>
        )}
      </span>
    );
  }

  let text: string;
  switch (state) {
    case "starting":
      text =
        rec.captureMode === "desktop"
          ? rec.appUnreachable
            ? "The DALI OS app didn't respond."
            : "Opening the DALI OS app…"
          : "Starting…";
      break;
    case "stopping":
      text = rec.stopStuck ? "The DALI OS app hasn't confirmed the stop." : "Stopping…";
      break;
    case "review":
      text = `${formatClock(rec.recordedSeconds)} recorded. Transcribing starts when you finish.`;
      break;
    case "processing":
      text = "Transcribing and labeling speakers. Usually a few minutes.";
      break;
    case "failed":
      text = rec.error ?? "Recording failed.";
      break;
    case "ready": {
      const n = rec.speakerKeys.length;
      text = n > 0 ? `Transcript ready. ${n} speaker${n === 1 ? "" : "s"}.` : "Transcript ready.";
      break;
    }
    case "generating":
      text = "Reading your notes and the transcript…";
      break;
    case "preview": {
      const preview = computeEnhancePreview(rec);
      const changed = preview?.ops.filter((op) => op.kind === "update").length ?? 0;
      const added = preview?.ops.reduce((n, op) => (op.kind === "insertAfter" ? n + op.blocks.length : n), 0) ?? 0;
      text = `Preview: ${changed} block${changed === 1 ? "" : "s"} changed, ${added} added.`;
      if (preview && preview.skipped > 0) {
        text += ` ${preview.skipped} block${preview.skipped === 1 ? "" : "s"} changed while this ran and were left as typed.`;
      }
      break;
    }
    case "enhanced":
      text = `Enhanced ${rec.enhancedAt ? formatDateTime(rec.enhancedAt) : ""}${rec.enhancedByName ? ` by ${rec.enhancedByName}` : ""}. Enhance again rebuilds the notes from the current text and the transcript.`;
      break;
    case "inserted":
      text = "Already in this note. Discarding only removes the recording, not what was inserted.";
      break;
    case "stalePreview":
      text = "Someone enhanced this note after your preview.";
      break;
    default:
      text = "";
  }
  if (rec.remote) text += ` · ${rec.remote.ownerIsYou ? "another device" : rec.remote.ownerName}`;
  return text;
}

function RailActions({ rec, state }: { rec: UseMeetingRecording; state: RailState }) {
  switch (state) {
    case "starting":
      if (rec.captureMode === "desktop" && rec.appUnreachable) {
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <IconButton label="Cancel" icon={Trash2} tone="destructive" onClick={rec.cancelStart} />
            <a href="/download" className={buttonClasses("secondary", "sm")}>
              <Download className="h-3.5 w-3.5" /> Get the app
            </a>
            <button type="button" onClick={rec.switchToBrowserAfterUnreachable} className={buttonClasses("primary", "sm")}>
              Record in this browser instead
            </button>
          </div>
        );
      }
      return rec.drives ? (
        <button type="button" onClick={rec.cancelStart} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
      ) : null;

    case "recording":
      return rec.drives ? (
        <button type="button" onClick={() => void rec.stop()} className={buttonClasses("secondary", "sm")}>
          <Square className="h-3 w-3 fill-current" /> Stop
        </button>
      ) : null;

    case "stopping":
      if (!rec.drives || !rec.stopStuck) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
          <button type="button" onClick={() => void rec.finishAndTranscribe()} className={buttonClasses("primary", "sm")}>
            Transcribe anyway
          </button>
        </div>
      );

    case "review":
      if (!rec.canEdit || !rec.drives) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void rec.resume()} className={buttonClasses("secondary", "sm")}>
            <Mic className="h-3.5 w-3.5" /> Continue
          </button>
          <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
          <button type="button" onClick={() => void rec.finishAndTranscribe()} className={buttonClasses("primary", "sm")}>
            Transcribe
          </button>
        </div>
      );

    case "processing":
      return rec.canDiscard ? (
        <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
      ) : null;

    case "failed":
      if (!rec.canEdit) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {rec.canDiscard && <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />}
          {rec.drives && !rec.finalized && (
            <button type="button" onClick={() => void rec.retryProcessing()} className={buttonClasses("primary", "sm")}>
              Try again
            </button>
          )}
        </div>
      );

    case "ready": {
      if (!rec.canEdit) return null;
      const label = !rec.aiEnabled
        ? "Insert transcript"
        : rec.enhancedAt
          ? "Enhance again"
          : rec.currentlyUntouched()
            ? "Write notes"
            : "Enhance notes";
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {rec.canDiscard && (
            <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} disabled={rec.busy} />
          )}
          {rec.aiEnabled && (
            <button
              type="button"
              onClick={() => rec.insert(null)}
              disabled={rec.busy}
              className={buttonClasses("secondary", "sm")}
            >
              Insert transcript
            </button>
          )}
          <button
            type="button"
            onClick={!rec.aiEnabled ? () => rec.insert(null) : () => void rec.onEnhanceClick(Boolean(rec.enhancedAt))}
            disabled={!rec.hasTranscript || rec.busy}
            className={buttonClasses("primary", "sm")}
          >
            {label}
          </button>
        </div>
      );
    }

    case "generating":
      return (
        <button type="button" onClick={rec.closeEnhancePreview} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
      );

    case "preview":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={rec.closeEnhancePreview} className={buttonClasses("secondary", "sm")}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void rec.applyEnhance()}
            disabled={rec.applyBusy}
            className={buttonClasses("primary", "sm")}
          >
            {rec.applyBusy ? "Applying…" : "Apply"}
          </button>
        </div>
      );

    case "enhanced":
      if (!rec.canEdit) return null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {rec.canDiscard && <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />}
          <button type="button" onClick={() => void rec.onEnhanceClick(true)} className={buttonClasses("primary", "sm")}>
            Enhance again
          </button>
        </div>
      );

    case "inserted":
      return rec.canDiscard ? (
        <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
      ) : null;

    case "stalePreview":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={rec.closeEnhancePreview} className={buttonClasses("secondary", "sm")}>
            Cancel
          </button>
          <button type="button" onClick={rec.reloadStalePreview} className={buttonClasses("primary", "sm")}>
            Reload preview
          </button>
        </div>
      );

    default:
      return null;
  }
}

function RailBody({ rec, state }: { rec: UseMeetingRecording; state: RailState }) {
  switch (state) {
    case "starting":
      return rec.captureMode === "desktop" && rec.appUnreachable ? (
        <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
          Update the DALI OS app, or record in this browser.
        </p>
      ) : null;

    case "recording":
      return <RecordingBody rec={rec} />;

    case "stopping":
      return rec.stopStuck ? (
        <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
          The app may have quit before it finished uploading.
        </p>
      ) : null;

    case "review":
      return rec.error ? <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">{rec.error}</p> : null;

    case "preview":
      return <EnhancePreview rec={rec} mode="preview" />;

    case "enhanced":
      return <EnhancePreview rec={rec} mode="enhanced" />;

    default:
      return null;
  }
}

/** Exported for the top-bar narrow-canvas live Popover. */
export function RecordingBody({ rec }: { rec: UseMeetingRecording }) {
  const channelLabel: Record<Channel, string> = { mic: "Microphone", call: "Call audio" };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3">
      {rec.captureMode === "browser" ? (
        <>
          {rec.channelsActive.length > 0 && (
            <p className="text-sm text-foreground">{rec.channelsActive.map((ch) => channelLabel[ch]).join(" · ")}</p>
          )}
          {rec.channelsActive.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {rec.channelsActive.map((ch) => (
                <li key={ch} className="flex items-center gap-2 text-sm">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-os-container">
                    <div
                      className="h-full rounded-full bg-os-accent transition-[width]"
                      style={{ width: `${Math.round((rec.levels[ch] ?? 0) * 100)}%` }}
                    />
                  </div>
                  {rec.stalled[ch] && <span className="text-xs text-red-700">Upload stalled</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-foreground">Recording via the DALI OS app.</p>
      )}
      <p className="text-xs text-muted-foreground">Type rough notes in the note; Enhance fills them in after you stop.</p>
    </div>
  );
}
