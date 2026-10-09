// The one TranscriptionProvider implementation: dali-asr on Modal. Presigns
// a GET URL per chunk at dispatch time (never stored or logged — they're
// dead in 30 minutes) and POSTs the job description. The job itself runs
// detached on Modal and calls back to /api/meeting-recordings/:id/result.
//
// NEVER log DIARIZE_URL, DIARIZE_SECRET, or a presigned chunk URL.

import type { Channel, ProcessRequest, TranscriptionProvider } from "./provider";
import { chunkKey, presignChunk } from "./chunks.server";

// Wire types matching specs/meeting-transcription.md exactly.

export type ModalJobChunk = { seq: number; url: string };
export type ModalJobSegment = { startSeconds: number; chunks: ModalJobChunk[] };
export type ModalJobChannel = { channel: Channel; segments: ModalJobSegment[]; maxSpeakers?: number };
export type ModalJobRequest = {
  recordingId: string;
  callbackUrl: string;
  channels: ModalJobChannel[];
};

export type ModalWord = { s: number; e: number; w: string };
export type ModalDiarizationSegment = { s: number; e: number; speaker: number };
export type ModalCallbackBody = {
  recordingId: string;
  channels: Record<string, { words: ModalWord[]; segments: ModalDiarizationSegment[] }>;
  error: string | null;
};

export class ModalTranscriptionProvider implements TranscriptionProvider {
  async process(req: ProcessRequest): Promise<void> {
    const url = process.env.DIARIZE_URL;
    const secret = process.env.DIARIZE_SECRET;
    if (!url || !secret) throw new Error("Transcription provider is not configured");

    const channels: ModalJobChannel[] = await Promise.all(
      req.channels.map(async (ch) => {
        const segments: ModalJobSegment[] = await Promise.all(
          ch.segments.map(async (seg) => {
            const chunks = await Promise.all(
              Array.from({ length: seg.seqCount }, (_, seq) =>
                presignChunk(chunkKey(req.recordingId, ch.channel, seg.segment, seq)).then(
                  (chunkUrl): ModalJobChunk => ({ seq, url: chunkUrl }),
                ),
              ),
            );
            return { startSeconds: seg.startSeconds, chunks };
          }),
        );
        return {
          channel: ch.channel,
          segments,
          ...(ch.maxSpeakers !== undefined ? { maxSpeakers: ch.maxSpeakers } : {}),
        };
      }),
    );

    const body: ModalJobRequest = { recordingId: req.recordingId, callbackUrl: req.callbackUrl, channels };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Transcription dispatch failed (${res.status})`);
    }
  }
}
