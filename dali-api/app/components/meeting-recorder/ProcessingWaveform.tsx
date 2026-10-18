import { useLayoutEffect, useRef } from "react";
import { cn } from "~/lib/cn";
import { animate, DUR } from "./motion";
import type { ProcessingStage, TranscriptLine } from "./types";

export type WaveformStage = ProcessingStage | "ready";

export const SPEAKER_COLORS = ["var(--os-role-violet-ink)", "var(--os-role-teal-ink)", "var(--os-role-orange-ink)"] as const;
const ACCENT = "var(--color-os-accent)";
const SOLID = "var(--color-os-container-hi)";
const LIGHT = "var(--color-os-container)";

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
export function solidBarCount(stage: WaveformStage, fraction: number): number {
  if (stage === "labeling" || stage === "ready") return WAVEFORM_BARS;
  if (stage !== "transcribing") return 0;
  return Math.round(Math.max(0, Math.min(1, fraction)) * WAVEFORM_BARS);
}

export function newlySolidRange(from: number, to: number): number[] {
  return to > from ? Array.from({ length: to - from }, (_, k) => from + k) : [];
}

type SpeakerLine = Pick<TranscriptLine, "at" | "end" | "speaker">;

export function speakerBarColors(lines: readonly SpeakerLine[], totalSeconds: number): string[] {
  const ordered = [...lines].filter((l) => l.speaker).sort((a, b) => a.at - b.at);
  const total = Math.max(totalSeconds, ...ordered.map((l) => l.end ?? l.at));
  if (ordered.length === 0 || !(total > 0)) return Array.from({ length: WAVEFORM_BARS }, () => ACCENT);
  const order = [...new Set(ordered.map((l) => l.speaker!))];
  return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
    const t = ((i + 0.5) / WAVEFORM_BARS) * total;
    const active = ordered.filter((l) => l.at <= t).pop();
    return active ? SPEAKER_COLORS[order.indexOf(active.speaker!) % SPEAKER_COLORS.length]! : ACCENT;
  });
}

export function ProcessingWaveform({
  stage,
  fraction,
  lines,
  totalSeconds = 0,
  className,
}: {
  stage: WaveformStage;
  fraction: number;
  lines?: readonly SpeakerLine[];
  totalSeconds?: number;
  className?: string;
}) {
  const solid = solidBarCount(stage, fraction);
  const clamped = Math.max(0, Math.min(1, fraction));
  const root = useRef<HTMLDivElement>(null);
  const lastSolid = useRef(solid);
  const colors = stage === "ready" ? speakerBarColors(lines ?? [], totalSeconds) : null;

  useLayoutEffect(() => {
    const from = lastSolid.current;
    lastSolid.current = solid;
    if (stage === "ready") return;
    const bars = root.current?.querySelectorAll<HTMLElement>("[data-bar]");
    for (const i of newlySolidRange(from, solid)) {
      void animate(
        bars?.[i],
        [
          { transform: "scaleY(.35)", backgroundColor: LIGHT },
          { transform: "scaleY(1)", backgroundColor: SOLID },
        ],
        DUR.barFill,
        { delay: (i - from) * DUR.barFillStagger },
      );
    }
  }, [solid, stage]);

  useLayoutEffect(() => {
    if (!colors) return;
    const bars = root.current?.querySelectorAll<HTMLElement>("[data-bar]");
    colors.forEach((color, i) => {
      void animate(bars?.[i], [{ backgroundColor: SOLID }, { backgroundColor: color }], DUR.speaker, { delay: i * DUR.speakerStagger });
    });
  }, [stage === "ready"]);

  return (
    <div
      ref={root}
      aria-hidden
      data-stage={stage}
      className={cn("relative flex h-8 min-w-[220px] flex-1 items-center gap-0.5", className)}
    >
      {WAVEFORM_HEIGHTS.map((h, i) => (
        <i
          key={i}
          data-bar={i}
          data-solid={i < solid}
          data-behind={stage === "labeling" && i < clamped * WAVEFORM_BARS}
          style={{
            height: `${h * 100}%`,
            ...(colors ? { backgroundColor: colors[i] } : {}),
            ...(stage === "starting"
              ? { animation: "enhance-wave-breathe 1.6s ease-in-out infinite", animationDelay: `${i * 14}ms` }
              : {}),
          }}
          className={cn(
            "min-w-px flex-1 rounded-sm motion-reduce:[animation:none]",
            !colors && (i < solid ? "bg-os-container-hi" : "bg-os-container"),
            stage === "labeling" && i < clamped * WAVEFORM_BARS && "brightness-90",
          )}
        />
      ))}
      {stage === "labeling" && (
        <span
          data-sweep
          style={{ left: `calc(${clamped * 100}% - 1px)` }}
          className="absolute -bottom-1 -top-1 w-0.5 rounded-sm bg-os-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-os-accent)_18%,transparent)] transition-[left] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
        />
      )}
    </div>
  );
}
