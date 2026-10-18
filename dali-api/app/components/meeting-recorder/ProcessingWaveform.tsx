import { cn } from "~/lib/cn";
import type { ProcessingStage } from "./types";

export const WAVEFORM_BARS = 60;

export const WAVEFORM_HEIGHTS: readonly number[] = (() => {
  let seed = 7;
  let prev = 0.5;
  return Array.from({ length: WAVEFORM_BARS }, () => {
    seed = (seed * 9301 + 49297) % 233280;
    prev = prev * 0.55 + (seed / 233280) * 0.45;
    return Math.round(Math.max(0.18, Math.min(1, prev * 1.25)) * 100) / 100;
  });
})();

/** How many bars read as transcribed: none before transcription starts, all
 *  of them once speaker labeling begins. */
export function solidBarCount(stage: ProcessingStage, fraction: number): number {
  if (stage === "labeling") return WAVEFORM_BARS;
  if (stage !== "transcribing") return 0;
  return Math.round(Math.max(0, Math.min(1, fraction)) * WAVEFORM_BARS);
}

export function ProcessingWaveform({
  stage,
  fraction,
  className,
}: {
  stage: ProcessingStage;
  fraction: number;
  className?: string;
}) {
  const solid = solidBarCount(stage, fraction);
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div
      aria-hidden
      data-stage={stage}
      className={cn("relative flex h-8 min-w-[220px] flex-1 items-center gap-0.5", className)}
    >
      {WAVEFORM_HEIGHTS.map((h, i) => (
        <i
          key={i}
          data-bar={i}
          data-solid={i < solid}
          style={{ height: `${h * 100}%` }}
          className={cn("min-w-px flex-1 rounded-sm", i < solid ? "bg-os-container-hi" : "bg-os-container")}
        />
      ))}
      {stage === "labeling" && (
        <span
          data-sweep
          style={{ left: `calc(${clamped * 100}% - 1px)` }}
          className="absolute -bottom-1 -top-1 w-0.5 rounded-sm bg-os-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-os-accent)_18%,transparent)]"
        />
      )}
    </div>
  );
}
