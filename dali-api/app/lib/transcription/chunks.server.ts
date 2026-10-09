// PCM chunk storage for a MeetingRecording — one object per 20s chunk, under
// a private prefix Modal reads via short-lived presigned URLs and dali-api
// deletes once the transcript is in. See specs/meeting-transcription.md.

import { putObject, listObjectKeys, deleteObjects, getDownloadUrl } from "~/lib/s3";

// Modal's presigned GET URLs: generated at dispatch, never stored or logged,
// dead within 30 minutes.
const CHUNK_URL_EXPIRES_SECONDS = 30 * 60;

export function recordingPrefix(recordingId: string): string {
  return `recordings/${recordingId}/`;
}

export function chunkKey(recordingId: string, channel: string, segment: number, seq: number): string {
  return `${recordingPrefix(recordingId)}${channel}/${segment}/${String(seq).padStart(4, "0")}.pcm`;
}

export async function putChunk(
  recordingId: string,
  channel: string,
  segment: number,
  seq: number,
  body: Buffer,
): Promise<void> {
  // Same key on retry = overwrite, which is how a same-seq re-upload after a
  // lost 2xx stays idempotent.
  await putObject(chunkKey(recordingId, channel, segment, seq), body, "audio/pcm");
}

export async function listChunkKeys(recordingId: string): Promise<string[]> {
  return listObjectKeys(recordingPrefix(recordingId));
}

export async function presignChunk(key: string): Promise<string> {
  return getDownloadUrl(key, { expiresIn: CHUNK_URL_EXPIRES_SECONDS });
}

/** Deletes every stored chunk for a recording. Safe to call on a recording
 *  with no chunks (list returns empty, delete no-ops). */
export async function deletePrefix(recordingId: string): Promise<void> {
  const keys = await listChunkKeys(recordingId);
  if (keys.length > 0) await deleteObjects(keys);
}
