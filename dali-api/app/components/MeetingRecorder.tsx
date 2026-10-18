import { Mic, Square } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Tooltip, Popover } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { ProgressRing } from "./meeting-recorder/ProgressRing";
import { describeProcessing } from "./meeting-recorder/processing-progress";
import { recorderTriggerLabel } from "./meeting-recorder/trigger-label";
import { RecordStartSheet } from "./meeting-recorder/RecordStartSheet";
import { deriveRailState, statusLineFor, RecordingBody } from "./meeting-recorder/RecordingRail";
import { formatClock } from "./meeting-recorder/transcript";
import type { UseMeetingRecording } from "./meeting-recorder/use-meeting-recording";

/**
 * The top-bar Record/status button, and the one modal the Recording rail
 * keeps — the start sheet (specs/meeting-recording-rail.md). The rail
 * itself renders in DocumentEditor's `rail` slot, built by the route from
 * the same `rec` this component mirrors; this component owns only the
 * trigger and, on a narrow canvas while live, a small Popover with the
 * meters/status/Stop (the rail can't show live states in the Drawer there).
 */
export function MeetingRecorder({ rec, containerWide }: { rec: UseMeetingRecording; containerWide: boolean }) {
  const { actionBtnPrimary, actionIcon } = useOsChrome();

  if (!rec.canShowRecorder) return null;

  const live = rec.phase === "recording" || rec.phase === "starting" || rec.phase === "stopping";
  const following = Boolean(rec.remote && !rec.remote.ownerIsYou);

  // While live the button stays the Record button, turned red; who is
  // recording and for how long is the tooltip's job, and the rail's.
  const status = live
    ? following
      ? `Recording · ${rec.remote!.ownerName}`
      : rec.phase === "recording"
        ? `Recording · ${formatClock(rec.elapsed)}`
        : rec.phase === "starting"
          ? "Starting…"
          : "Stopping…"
    : null;

  const processing =
    rec.phase === "processing" ? describeProcessing(rec.processingStage ?? "starting", rec.progress) : null;

  const triggerLabel = recorderTriggerLabel(rec, live, processing?.pillLabel ?? null);

  const button = (
    <button
      type="button"
      onClick={live && !containerWide ? undefined : () => rec.setOpen(!rec.open)}
      aria-label={status ?? triggerLabel}
      aria-pressed={rec.phase !== "idle" ? rec.open : undefined}
      data-recording={live || undefined}
      className={cn(
        actionBtnPrimary,
        live && "border-os-accent bg-os-accent text-navy-deep hover:border-accent-coral-light hover:bg-accent-coral-light",
      )}
    >
      {processing ? <ProgressRing fraction={processing.fraction} className={actionIcon} /> : <Mic className={actionIcon} />}
      {rec.phase === "recording" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      <span className="hidden sm:inline">{triggerLabel}</span>
    </button>
  );

  return (
    <>
      {live && !containerWide ? (
        <Popover trigger={button} ariaLabel="Recording">
          <LivePopoverBody rec={rec} />
        </Popover>
      ) : (
        <Tooltip content={status ?? triggerLabel}>{button}</Tooltip>
      )}
      <RecordStartSheet rec={rec} />
    </>
  );
}

/** Narrow-canvas live state: the rail can't show it in the Drawer (people
 *  are typing notes while it runs), so this Popover carries the meters, the
 *  status line, and Stop. */
function LivePopoverBody({ rec }: { rec: UseMeetingRecording }) {
  const state = deriveRailState(rec);
  if (!state) return null;
  return (
    <div className="flex w-64 flex-col gap-2 p-1">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {statusLineFor(rec, state)}
      </p>
      {rec.phase === "recording" && <RecordingBody rec={rec} />}
      {rec.drives && rec.phase !== "stopping" && (
        <button
          type="button"
          onClick={() => void rec.stop()}
          className={buttonClasses("secondary", "sm")}
        >
          <Square className="h-3 w-3 fill-current" /> Stop
        </button>
      )}
    </div>
  );
}
