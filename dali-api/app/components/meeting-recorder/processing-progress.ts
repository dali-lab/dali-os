import type { ProcessingStage, RecordingProgress } from "./types";

export const WINDOW_SECONDS = 300;

export type ProcessingDescription = {
  title: string;
  detail: string;
  fraction: number;
  pillLabel: "Transcribing" | "Labeling";
};

function ratio(completed: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, completed / total));
}

export function describeProcessing(stage: ProcessingStage, progress: RecordingProgress | null): ProcessingDescription {
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  switch (stage) {
    case "starting":
      return { title: "Starting up", detail: "Getting the transcriber ready", fraction: 0, pillLabel: "Transcribing" };
    case "fetching":
      return {
        title: "Preparing audio",
        detail: `${completed} of ${total} parts`,
        fraction: ratio(completed, total),
        pillLabel: "Transcribing",
      };
    case "transcribing": {
      const totalMin = Math.round((progress?.audioSeconds ?? 0) / 60);
      const doneMin = Math.min((completed * WINDOW_SECONDS) / 60, totalMin);
      return {
        title: "Transcribing",
        detail: `${doneMin} of ${totalMin} min`,
        fraction: ratio(completed, total),
        pillLabel: "Transcribing",
      };
    }
    case "labeling": {
      const fraction = ratio(completed, total);
      return {
        title: "Labeling speakers",
        detail: `Finding who spoke when · ${Math.round(fraction * 100)}%`,
        fraction,
        pillLabel: "Labeling",
      };
    }
  }
}
