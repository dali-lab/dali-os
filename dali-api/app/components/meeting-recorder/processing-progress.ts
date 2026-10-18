import type { ProcessingStage, RecordingProgress, RecordingProgressStage } from "./types";

export type ProcessingDescription = {
  title: string;
  detail: string;
  fraction: number;
  pillLabel: "Transcribing" | "Labeling";
};

export const STAGE_WEIGHT: Record<RecordingProgressStage, number> = { fetching: 0.1, transcribing: 0.6, labeling: 0.3 };
const STAGE_START: Record<RecordingProgressStage, number> = { fetching: 0, transcribing: 0.1, labeling: 0.7 };

function ratio(completed: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, completed / total));
}

/** Position across every channel's fetch, transcribe and label stages, so the
 *  ring and waveform never move backwards when the second channel starts. */
export function overallFraction(stage: RecordingProgressStage, progress: RecordingProgress | null): number {
  const channels = Math.max(1, progress?.channels ?? 1);
  const channel = Math.min(channels, Math.max(1, progress?.channel ?? 1));
  const within = STAGE_START[stage] + STAGE_WEIGHT[stage] * ratio(progress?.completed ?? 0, progress?.total ?? 0);
  return Math.max(0, Math.min(1, (channel - 1 + within) / channels));
}

function minutesDetail(progress: RecordingProgress | null): string {
  const audioSeconds = progress?.audioSeconds ?? 0;
  if (audioSeconds < 60) return "Under a minute";
  const totalMin = Math.max(1, Math.round(audioSeconds / 60));
  const doneMin = Math.min(totalMin, Math.round(ratio(progress?.completed ?? 0, progress?.total ?? 0) * (audioSeconds / 60)));
  return `${doneMin} of ${totalMin} min`;
}

export function describeProcessing(stage: ProcessingStage, progress: RecordingProgress | null): ProcessingDescription {
  if (stage === "starting") {
    return { title: "Starting up", detail: "Getting the transcriber ready", fraction: 0, pillLabel: "Transcribing" };
  }

  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const fraction = overallFraction(stage, progress);
  const channelNote = progress && progress.channels > 1 ? ` · channel ${progress.channel} of ${progress.channels}` : "";

  switch (stage) {
    case "fetching":
      return { title: "Preparing audio", detail: `${completed} of ${total} parts${channelNote}`, fraction, pillLabel: "Transcribing" };
    case "transcribing":
      return { title: "Transcribing", detail: `${minutesDetail(progress)}${channelNote}`, fraction, pillLabel: "Transcribing" };
    case "labeling":
      return {
        title: "Labeling speakers",
        detail: `Finding who spoke when · ${Math.round(ratio(completed, total) * 100)}%${channelNote}`,
        fraction,
        pillLabel: "Labeling",
      };
  }
}
