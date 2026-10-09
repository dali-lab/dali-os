// Transcription provider seam (specs/meeting-transcription.md). One
// implementation today (`modal.ts`); swapping vendors later is a contained
// change behind this interface. Unset env means unavailable, same pattern as
// the AI doc provider (`isAiEnabled` in ai.server.ts) — callers answer 503.
//
// modal.ts imports this file's types with `import type` only, so there is no
// runtime import cycle even though the two files reference each other.

import { ModalTranscriptionProvider } from "./modal";

export type Channel = "mic" | "call";

export type ProcessRequestSegment = {
  /** segmentStarts index — carried through so the provider can rebuild the
   *  chunk key without re-deriving it from array position after filtering. */
  segment: number;
  startSeconds: number;
  /** Chunks 0..seqCount-1 are expected to exist for this segment (gaps are
   *  filled with silence by the provider). */
  seqCount: number;
};

export type ProcessRequestChannel = {
  channel: Channel;
  segments: ProcessRequestSegment[];
  maxSpeakers?: number;
};

export type ProcessRequest = {
  recordingId: string;
  callbackUrl: string;
  channels: ProcessRequestChannel[];
};

export interface TranscriptionProvider {
  process(req: ProcessRequest): Promise<void>;
}

/** True when a transcription backend is configured. */
export function isTranscriptionEnabled(): boolean {
  return Boolean(process.env.DIARIZE_URL && process.env.DIARIZE_SECRET);
}

export function getTranscriptionProvider(): TranscriptionProvider | null {
  return isTranscriptionEnabled() ? new ModalTranscriptionProvider() : null;
}
