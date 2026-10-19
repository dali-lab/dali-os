import type { UseMeetingRecording } from "./use-meeting-recording";

type LabelInput = Pick<UseMeetingRecording, "phase" | "canEdit" | "hasTranscript" | "pendingMarks" | "enhancedAt">;

/** The top-bar pill's text. Review lives in the note now, so a pending
 *  review reads as the plain transcript entry point. */
export function recorderTriggerLabel(rec: LabelInput, live: boolean, processingPill: string | null): string {
  if (live) return "Record";
  if (rec.phase === "idle") return rec.canEdit ? "Record" : "Transcript";
  if (processingPill) return processingPill;
  if (!rec.hasTranscript) return "Show recording";
  return rec.pendingMarks.length === 0 && rec.enhancedAt ? "Enhanced" : "Transcript";
}
