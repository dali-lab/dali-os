// Backstop for recordings whose client never confirmed Stop cleanly, or
// whose transcription job never called back. See specs/meeting-transcription
// .md "Jobs" (a)(b)(c)(d). Idempotent: a row only matches one of the four
// queries at a time, and each branch's own update moves it out of that
// query for the next tick.

import { prisma } from "~/lib/db.server";
import {
  RETRY_PENDING_MARKER,
  applyResult,
  finalizeEmpty,
  startProcessing,
} from "~/lib/meeting-recording.server";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import type { JobContext, JobResult } from "~/jobs/registry";

const TAKE = 50;
const LAST_CHUNK_STALE_MS = 10 * 60_000;
const PROCESSING_TIMEOUT_MS = 30 * 60_000;
const PENDING_UNCLAIMED_MS = 30 * 60_000;
const STOPPED_UNFINISHED_MS = 30 * 60_000;

export async function runRecordingFinalizer({ now }: JobContext): Promise<JobResult> {
  // (a) A client that stopped uploading without confirming Stop (closed tab,
  // crashed app, or never claimed at all). lastChunkAt only moves forward on
  // a real chunk upload, so a long gap means the session is over; a row that
  // never got a single chunk has no lastChunkAt to go stale, so updatedAt
  // (set at claim/create) is the fallback staleness signal.
  const abandoned = await prisma.meetingRecording.findMany({
    where: {
      status: "Recording",
      OR: [
        { lastChunkAt: { lt: new Date(now.getTime() - LAST_CHUNK_STALE_MS) } },
        { lastChunkAt: null, updatedAt: { lt: new Date(now.getTime() - LAST_CHUNK_STALE_MS) } },
      ],
    },
    take: TAKE,
  });
  for (const rec of abandoned) {
    if (rec.channels.length > 0) {
      await startProcessing(rec);
    } else {
      await finalizeEmpty(rec);
    }
  }

  // (b) A dispatched job that never called back. Retry once (tagging the row
  // so a second timeout is recognized as a retry, not a first attempt); fail
  // it — deleting the audio — on the second timeout. A late callback after
  // that still applies via applyResult's own idempotency.
  const stuck = await prisma.meetingRecording.findMany({
    where: { status: "Processing", updatedAt: { lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS) } },
    take: TAKE,
  });
  for (const rec of stuck) {
    if (rec.error === RETRY_PENDING_MARKER) {
      await applyResult(rec, { channels: {}, error: "Transcription timed out." });
    } else {
      await prisma.meetingRecording.update({ where: { id: rec.id }, data: { error: RETRY_PENDING_MARKER } });
      await startProcessing(rec);
    }
  }

  // (c) Created but never claimed by a browser tab or the desktop app.
  const unclaimed = await prisma.meetingRecording.findMany({
    where: { status: "Pending", createdAt: { lt: new Date(now.getTime() - PENDING_UNCLAIMED_MS) } },
    take: TAKE,
  });
  for (const rec of unclaimed) {
    await deletePrefix(rec.id);
    await prisma.meetingRecording.delete({ where: { id: rec.id } });
  }

  // (d) The owner pressed Stop but never came back to press Transcribe or
  // Discard. Same disposition as (a): transcribe what's there, or finalize
  // empty.
  const stoppedUnfinished = await prisma.meetingRecording.findMany({
    where: { status: "Stopped", updatedAt: { lt: new Date(now.getTime() - STOPPED_UNFINISHED_MS) } },
    take: TAKE,
  });
  for (const rec of stoppedUnfinished) {
    if (rec.channels.length > 0) {
      await startProcessing(rec);
    } else {
      await finalizeEmpty(rec);
    }
  }

  return {
    items: abandoned.length + stuck.length + unclaimed.length + stoppedUnfinished.length,
    note: `abandoned=${abandoned.length} stuck=${stuck.length} unclaimed=${unclaimed.length} stoppedUnfinished=${stoppedUnfinished.length}`,
  };
}
