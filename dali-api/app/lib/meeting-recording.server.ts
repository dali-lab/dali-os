// Server side of meeting recording (see the MeetingRecording model and
// specs/meeting-transcription.md). The page and the desktop app both talk to
// the same row: the page with its cookie session, the app with its desktop
// Session Bearer token. PCM chunks land in S3; at Stop the row is handed to
// the transcription provider, whose callback fills in words/lines/speakers.
//
// NEVER log transcript text, chunk bytes, or a presigned chunk URL.

import { prisma } from "~/lib/db";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { isPresenceRoom } from "~/collab/roomName";
import { getApiBaseUrl } from "~/lib/app-env";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import { getTranscriptionProvider } from "~/lib/transcription/provider";
import type { Channel, ProcessRequest, ProcessRequestChannel, ProcessRequestSegment } from "~/lib/transcription/provider";
import { assignSpeakers, wordsToLines, mergeChannels } from "~/lib/transcription/words";
import type { Word, DiarizationSegment, RawLine } from "~/lib/transcription/words";
import type { MeetingRecording } from "~/generated/prisma/client";
import type { TranscriptLine } from "~/lib/meeting-transcript";

// Anything older than this, never finalized, is an abandoned recording
// (closed tab, crashed app, crashed browser) — not merely stopped.
const STALE_MS = 24 * 60 * 60 * 1000;

// Lab-wide cap on simultaneously live recordings (Pending or Recording).
export const MAX_ACTIVE_RECORDINGS = 12;

// Internal sentinel: recording-finalizer stashes this in `error` while a
// retried Processing row is still in flight, so a second timeout can tell
// "never retried" from "already retried once" without a schema change. Never
// surfaced — `error` is only read by clients once `status` is Failed.
export const RETRY_PENDING_MARKER = "__retry_pending__";

const SPEAKER_KEY = /^(mic|call):\d+$/;
const MAX_SPEAKER_NAME = 80;

export function recordingDeepLink(id: string): string {
  return `dalios://record?id=${encodeURIComponent(id)}`;
}

/** Whether this user may record into a collab document: the same write
 *  check the collab server applies to the room itself. */
export async function canRecordInto(userId: string, documentName: string): Promise<boolean> {
  if (!documentName || isPresenceRoom(documentName)) return false;
  const access = await authorizeCollabDoc(userId, documentName);
  return access.allowed && !access.readOnly;
}

/** Owner gets everything; anyone who can view the note gets a read-only
 *  view; everyone else gets nothing. Mirrors authorizeCollabDoc so a
 *  transcript's audience always matches the note's. */
export async function canReadRecording(
  rec: Pick<MeetingRecording, "userId" | "documentName">,
  userId: string,
): Promise<"owner" | "viewer" | null> {
  if (rec.userId === userId) return "owner";
  const access = await authorizeCollabDoc(userId, rec.documentName);
  return access.allowed ? "viewer" : null;
}

/** The document's title for the notes prompt, when it's a Drive page. */
export async function documentTitle(documentName: string): Promise<string | null> {
  const [entity, id] = documentName.split(":");
  if (entity !== "doc" || !id) return null;
  const page = await prisma.page.findUnique({ where: { id }, select: { title: true } });
  return page?.title ?? null;
}

/** Whether the project behind a scheduled meeting has recording turned off.
 *  A meeting with no project (or no meeting at all) is never disabled. */
export async function projectRecordingDisabled(scheduledMeetingId: string): Promise<boolean> {
  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: scheduledMeetingId },
    select: { project: { select: { recordingPolicy: true } } },
  });
  return meeting?.project?.recordingPolicy === "Disabled";
}

export async function createRecording(
  userId: string,
  documentName: string,
  meeting: { scheduledMeetingId?: string; occurrenceStart?: Date | null } = {},
): Promise<MeetingRecording | null> {
  const stale = await prisma.meetingRecording.findMany({
    where: { userId, finalizedAt: null, createdAt: { lt: new Date(Date.now() - STALE_MS) } },
    select: { id: true },
  });
  for (const row of stale) {
    await deletePrefix(row.id);
  }
  if (stale.length > 0) {
    await prisma.meetingRecording.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  }

  const active = await prisma.meetingRecording.count({
    where: { status: { in: ["Pending", "Recording"] } },
  });
  if (active >= MAX_ACTIVE_RECORDINGS) return null;

  return prisma.meetingRecording.create({
    data: {
      userId,
      documentName,
      // Segment 0's start is explicit here so `claim`'s
      // `segmentStarts[segment]` always has an entry for the current segment.
      segmentStarts: [0],
      ...(meeting.scheduledMeetingId ? { scheduledMeetingId: meeting.scheduledMeetingId } : {}),
      ...(meeting.occurrenceStart ? { occurrenceStart: meeting.occurrenceStart } : {}),
    },
  });
}

/** The row, or null when it doesn't exist or belongs to someone else. */
export async function ownRecording(id: string, userId: string): Promise<MeetingRecording | null> {
  const rec = await prisma.meetingRecording.findUnique({ where: { id } });
  return rec && rec.userId === userId ? rec : null;
}

export function storedLines(rec: Pick<MeetingRecording, "lines">): TranscriptLine[] {
  return Array.isArray(rec.lines) ? (rec.lines as TranscriptLine[]) : [];
}

/** Desktop owner probe before the mic opens (replaces the old `append`
 *  probe). Returns the current segment and its start offset so a
 *  newly-claimed session (first claim, or after Continue) stamps its chunks
 *  from the right place. */
export async function claimRecording(
  rec: MeetingRecording,
): Promise<{ ok: true; offset: number; segment: number } | { ok: false }> {
  if (rec.status !== "Pending" && rec.status !== "Recording") return { ok: false };
  if (rec.status === "Pending") {
    await prisma.meetingRecording.update({ where: { id: rec.id }, data: { status: "Recording" } });
  }
  const segment = Math.max(0, rec.segmentStarts.length - 1);
  return { ok: true, offset: rec.segmentStarts[segment] ?? 0, segment };
}

/** Browser/desktop chunk upload: stores the high-water seq and flips
 *  Pending → Recording on the first chunk. Returns the up-to-date
 *  stopRequested so a chunk in flight when Stop is clicked still learns it. */
export async function recordChunk(
  rec: MeetingRecording,
  channel: Channel,
  segment: number,
  seq: number,
): Promise<{ stopRequested: boolean }> {
  const channels = rec.channels.includes(channel) ? rec.channels : [...rec.channels, channel];
  const chunkIndex = { ...((rec.chunkIndex as Record<string, number[]> | null) ?? {}) };
  const highWater = [...(chunkIndex[channel] ?? [])];
  highWater[segment] = Math.max(highWater[segment] ?? -1, seq);
  chunkIndex[channel] = highWater;

  const updated = await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: {
      channels,
      chunkIndex,
      lastChunkAt: new Date(),
      ...(rec.status === "Pending" ? { status: "Recording" as const } : {}),
    },
    select: { stopRequested: true },
  });
  return { stopRequested: updated.stopRequested };
}

/** Page: ask for the recording to stop. A session the app/browser never
 *  claimed (still Pending) just ends outright. */
export async function requestStop(rec: Pick<MeetingRecording, "id" | "status">): Promise<void> {
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: rec.status === "Pending" ? { status: "Stopped", stopRequested: true } : { stopRequested: true },
  });
}

/** Page: Continue a stopped, not-yet-processed recording. Pushes a new
 *  segment starting where the transcript left off. */
export async function resumeRecording(
  rec: Pick<MeetingRecording, "id" | "status" | "finalizedAt" | "recordedSeconds">,
): Promise<boolean> {
  if (rec.status !== "Stopped" || rec.finalizedAt !== null) return false;
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: {
      segmentStarts: { push: rec.recordedSeconds },
      status: "Pending",
      stopRequested: false,
      error: null,
    },
  });
  return true;
}

/** Desktop app: the recorder has exited, cleanly or not, after recording
 *  `seconds` in this session. */
export async function finishRecording(
  rec: Pick<MeetingRecording, "id">,
  error: string | null,
  seconds: number,
): Promise<void> {
  const recordedSeconds = { increment: Number.isFinite(seconds) && seconds > 0 ? seconds : 0 };
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: error
      ? { status: "Failed", error: error.slice(0, 500), recordedSeconds }
      : { status: "Stopped", recordedSeconds },
  });
}

/** Validates a `{ "mic:1": userId | text }` rename payload. Null on any
 *  malformed key/value — the caller rejects the whole request rather than
 *  partially applying it. */
export function parseSpeakerMap(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SPEAKER_KEY.test(key)) return null;
    if (typeof value !== "string" || !value.trim() || value.length > MAX_SPEAKER_NAME) return null;
    out[key] = value.trim();
  }
  return out;
}

/** Merges a validated rename map into the recording's speakers. */
export async function setSpeakers(
  rec: Pick<MeetingRecording, "id" | "speakers">,
  patch: Record<string, string>,
): Promise<void> {
  const existing = (rec.speakers as Record<string, string> | null) ?? {};
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: { speakers: { ...existing, ...patch } },
  });
}

function buildProcessRequest(
  rec: Pick<MeetingRecording, "id" | "channels" | "segmentStarts" | "chunkIndex">,
): ProcessRequest {
  const chunkIndex = (rec.chunkIndex as Record<string, number[]> | null) ?? {};
  const channels: ProcessRequestChannel[] = rec.channels.map((channel) => {
    const highWater = chunkIndex[channel] ?? [];
    const segments: ProcessRequestSegment[] = [];
    highWater.forEach((hw, segment) => {
      if (typeof hw === "number" && hw >= 0) {
        segments.push({ segment, startSeconds: rec.segmentStarts[segment] ?? 0, seqCount: hw + 1 });
      }
    });
    // The mic channel is capped to one speaker once call audio exists — the
    // call side is everyone else, so diarizing mic further is just noise.
    const maxSpeakers = channel === "mic" && rec.channels.includes("call") ? 1 : undefined;
    return {
      channel: channel as Channel,
      segments,
      ...(maxSpeakers !== undefined ? { maxSpeakers } : {}),
    };
  });

  return {
    recordingId: rec.id,
    callbackUrl: `${getApiBaseUrl()}/api/meeting-recordings/${rec.id}/result`,
    channels,
  };
}

/** Dispatches the recording to the transcription provider. Sets Failed (and
 *  cleans up S3) immediately on dispatch failure or a missing provider;
 *  otherwise leaves the row Processing for the callback (or the finalizer's
 *  timeout) to resolve. */
export async function startProcessing(
  rec: Pick<MeetingRecording, "id" | "channels" | "segmentStarts" | "chunkIndex">,
): Promise<void> {
  await prisma.meetingRecording.update({ where: { id: rec.id }, data: { status: "Processing" } });

  const provider = getTranscriptionProvider();
  if (!provider) {
    await failRecording(rec, "Transcription is not configured.");
    return;
  }
  try {
    await provider.process(buildProcessRequest(rec));
  } catch (err) {
    await failRecording(rec, err instanceof Error ? err.message : "Transcription dispatch failed.");
  }
}

async function failRecording(rec: Pick<MeetingRecording, "id">, message: string): Promise<void> {
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: { status: "Failed", error: message.slice(0, 500), finalizedAt: new Date() },
  });
  await deletePrefix(rec.id);
}

/** Stop with zero chunks ever uploaded: nothing to transcribe, nothing to
 *  delete, but still a terminal state (not resumable). */
export async function finalizeEmpty(rec: Pick<MeetingRecording, "id">): Promise<void> {
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: { status: "Stopped", finalizedAt: new Date() },
  });
  await deletePrefix(rec.id);
}

export type ApplyResultBody = {
  channels: Record<string, { words: Word[]; segments: DiarizationSegment[] }>;
  error: string | null;
};

/**
 * Applies the transcription callback. Idempotent: once a row is Done,
 * further callbacks (success or error) are no-ops, so repeat delivery never
 * re-does the work or regresses the state. A row the finalizer already
 * marked Failed still accepts a late success callback and becomes Done.
 */
export async function applyResult(
  rec: Pick<MeetingRecording, "id" | "status" | "finalizedAt">,
  body: ApplyResultBody,
): Promise<void> {
  if (rec.status === "Done") return;

  if (body.error) {
    await prisma.meetingRecording.update({
      where: { id: rec.id },
      data: {
        status: "Failed",
        error: body.error.slice(0, 500),
        finalizedAt: rec.finalizedAt ?? new Date(),
      },
    });
    await deletePrefix(rec.id);
    return;
  }

  const words: Record<string, Word[]> = {};
  const linesByChannel: Record<string, RawLine[]> = {};
  for (const [channel, data] of Object.entries(body.channels)) {
    const assigned = assignSpeakers(data.words, data.segments);
    words[channel] = assigned;
    linesByChannel[channel] = wordsToLines(assigned);
  }
  const lines = mergeChannels(linesByChannel);

  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: {
      status: "Done",
      error: null,
      words,
      lines,
      finalizedAt: rec.finalizedAt ?? new Date(),
    },
  });
  await deletePrefix(rec.id);
}

const DEFAULT_SPEAKER_LABEL: Record<Channel, string> = { mic: "You", call: "Others" };

/** Display name for a "mic:1"-style speaker key, for the AI notes prompt:
 *  a renamed speaker (userId resolved to a display name, or free text) wins;
 *  otherwise the first/only speaker on a channel reads as You/Others and any
 *  further diarized speaker on that channel reads as "Speaker N". */
function speakerLabel(
  key: string,
  speakers: Record<string, string>,
  usersById: Map<string, string>,
  singlePerChannel: Set<string>,
): string {
  const rename = speakers[key];
  if (rename) return usersById.get(rename) ?? rename;

  const [channel, indexRaw] = key.split(":");
  const index = Number(indexRaw);
  if ((channel === "mic" || channel === "call") && singlePerChannel.has(channel)) {
    return DEFAULT_SPEAKER_LABEL[channel];
  }
  return Number.isFinite(index) ? `Speaker ${index}` : "Speaker";
}

/** Formats a recording's lines as "[mm:ss] <Speaker>: text" for the AI notes
 *  prompt, resolving speaker keys through the recording's rename map (a
 *  userId resolves to a display name; free text passes through). */
export async function formatRecordingTranscript(
  rec: Pick<MeetingRecording, "lines" | "speakers">,
): Promise<string> {
  const lines = storedLines(rec);
  const speakers = (rec.speakers as Record<string, string> | null) ?? {};

  const userIds = Object.values(speakers).filter((v) => /^c[a-z0-9]{20,}$/i.test(v));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const usersById = new Map(
    users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.id]),
  );

  const singlePerChannel = new Set<string>();
  for (const channel of ["mic", "call"] as const) {
    const indices = new Set(
      lines
        .filter((l) => l.channel === channel && l.speaker)
        .map((l) => l.speaker!.split(":")[1]),
    );
    if (indices.size <= 1) singlePerChannel.add(channel);
  }

  const formatClock = (totalSeconds: number) => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  return [...lines]
    .filter((l) => l.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((l) => {
      const who = l.speaker
        ? speakerLabel(l.speaker, speakers, usersById, singlePerChannel)
        : l.source
          ? DEFAULT_SPEAKER_LABEL[l.source === "you" ? "mic" : "call"]
          : "Speaker";
      return `[${formatClock(l.at)}] ${who}: ${l.text.trim()}`;
    })
    .join("\n");
}
