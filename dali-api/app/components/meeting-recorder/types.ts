// Shared, client-safe types for the meeting recorder — mirrors the
// MeetingRecording contract in specs/meeting-transcription.md exactly, so the
// server and client PRs type-check against the same shape.

import type { TranscriptLine as ServerTranscriptLine } from "~/lib/meeting-transcript";

export type Channel = "mic" | "call";

export type RecordingStatus = "Pending" | "Recording" | "Stopped" | "Processing" | "Done" | "Failed";

/** "mic:1", "call:2", … — a diarized speaker within a channel. */
export type SpeakerKey = string;

/** Keyed by SpeakerKey; value is a User.id or free-text ("Someone else…"). */
export type Speakers = Record<SpeakerKey, string>;

/**
 * Narrows the server's own TranscriptLine (~/lib/meeting-transcript, which
 * `storedLines` on the server returns) to the v2 shape every line actually
 * has: `ai-meeting-notes` was off before this release, so there are no
 * pre-v2 rows with only `source` and no `channel` to fall back to.
 */
export type TranscriptLine = ServerTranscriptLine & { channel: Channel; end: number };

export type RosterUser = { userId: string; name: string };

export type StartRecordingResponse = {
  id: string;
  link: string;
  transcriptionEnabled: boolean;
  aiEnabled: boolean;
};

export type ChunkResponse = {
  stopRequested: boolean;
  behindSeconds: number;
  lines: TranscriptLine[];
};

/**
 * GET /api/meeting-recordings/:id. The owner gets the fuller shape
 * (stopRequested, total/since paging, error); any other viewer who can read
 * the note gets the read-only subset — those fields come back undefined.
 */
export type PollRecordingResponse = {
  status: RecordingStatus;
  channels: Channel[];
  recordedSeconds: number;
  lines: TranscriptLine[];
  speakers: Speakers;
  error?: string | null;
  stopRequested?: boolean;
  total?: number;
};
