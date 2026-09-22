// Server side of native meeting recording (see the MeetingRecording model).
// The page and the desktop app both talk to the same owner-only row: the page
// with its cookie session, the app with its desktop Session Bearer token.

import { prisma } from "~/lib/db";
import type { MeetingRecording } from "~/generated/prisma/client";
import type { TranscriptLine } from "~/lib/meeting-transcript";

const MAX_LINES_PER_APPEND = 200;
const MAX_LINES = 20_000;
const MAX_LINE_CHARS = 2_000;
// Anything older than this is an abandoned recording (closed tab, crashed app).
const STALE_MS = 24 * 60 * 60 * 1000;

export function recordingDeepLink(id: string): string {
  return `dalios://record?id=${encodeURIComponent(id)}`;
}

export async function createRecording(userId: string, pageId: string): Promise<MeetingRecording> {
  await prisma.meetingRecording.deleteMany({
    where: { userId, createdAt: { lt: new Date(Date.now() - STALE_MS) } },
  });
  return prisma.meetingRecording.create({ data: { userId, pageId } });
}

/** The row, or null when it doesn't exist or belongs to someone else. */
export async function ownRecording(id: string, userId: string): Promise<MeetingRecording | null> {
  const rec = await prisma.meetingRecording.findUnique({ where: { id } });
  return rec && rec.userId === userId ? rec : null;
}

export function storedLines(rec: Pick<MeetingRecording, "lines">): TranscriptLine[] {
  return Array.isArray(rec.lines) ? (rec.lines as TranscriptLine[]) : [];
}

// Drops anything malformed rather than failing the batch: one bad line from
// the recognizer shouldn't lose the rest of the meeting.
export function cleanLines(raw: unknown): TranscriptLine[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptLine[] = [];
  for (const l of raw.slice(0, MAX_LINES_PER_APPEND)) {
    if (!l || typeof l !== "object") continue;
    const { at, text, source } = l as Record<string, unknown>;
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    out.push({
      at,
      text: text.trim().slice(0, MAX_LINE_CHARS),
      ...(source === "you" || source === "others" ? { source } : {}),
    });
  }
  return out;
}

/** Desktop app: add transcribed lines. Returns whether the page asked to stop,
 *  and the offset this session's timestamps start from. */
export async function appendLines(
  rec: MeetingRecording,
  lines: TranscriptLine[],
  systemAudio: boolean | undefined,
): Promise<{ stopRequested: boolean; offset: number }> {
  const offset = rec.recordedSeconds;
  // The app appends every couple of seconds even when nobody spoke, as its way
  // of hearing a Stop. Answer those without rewriting the transcript.
  const unchanged =
    lines.length === 0 &&
    rec.status !== "Pending" &&
    (systemAudio === undefined || systemAudio === rec.systemAudio);
  if (unchanged) return { stopRequested: rec.stopRequested, offset };

  const merged = [...storedLines(rec), ...lines].slice(-MAX_LINES);
  const updated = await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: {
      lines: merged,
      // An append after Stop (the app flushing its last phrases) keeps it stopped.
      ...(rec.status === "Pending" ? { status: "Recording" as const } : {}),
      ...(systemAudio !== undefined ? { systemAudio } : {}),
    },
    select: { stopRequested: true },
  });
  return { stopRequested: updated.stopRequested, offset };
}

/** Page: Continue a stopped recording into the same transcript. The app is
 *  handed the same id again and picks up where the last session ended. */
export async function resumeRecording(rec: MeetingRecording): Promise<boolean> {
  if (rec.status !== "Stopped" && rec.status !== "Failed") return false;
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: { status: "Pending", stopRequested: false, error: null },
  });
  return true;
}

/** Page: ask the app to stop. A recording the app never picked up just ends. */
export async function requestStop(rec: MeetingRecording): Promise<void> {
  await prisma.meetingRecording.update({
    where: { id: rec.id },
    data: rec.status === "Pending" ? { status: "Stopped", stopRequested: true } : { stopRequested: true },
  });
}

/** Desktop app: the recorder has exited, cleanly or not, after recording
 *  `seconds` in this session. */
export async function finishRecording(
  rec: MeetingRecording,
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
