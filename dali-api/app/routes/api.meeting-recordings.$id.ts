// /api/meeting-recordings/:id — one recording. Used by three audiences:
//   - The owner (page cookie session, or the desktop app's Session Bearer):
//     GET for the full state, POST actions (claim/stop/resume/speakers/
//     finish), DELETE to discard.
//   - Any other viewer of the note (authorizeCollabDoc): GET a read-only
//     view, POST {action:"speakers"} (any editor, via canRecordInto).
//   - Core: DELETE even when not the owner.
// Old (pre-v2) desktop builds call {action:"append"} and get 410 — the page
// itself detects a stuck Pending row and tells the user to update.
//
// NEVER log transcript text.

import type { Route } from "./+types/api.meeting-recordings.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { deletePrefix } from "~/lib/transcription/chunks.server";
import {
  canReadRecording,
  canRecordInto,
  claimRecording,
  finalizeEmpty,
  finishRecording,
  parseSpeakerMap,
  requestStop,
  resumeRecording,
  setSpeakers,
  startProcessing,
  storedLines,
} from "~/lib/meeting-recording.server";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec) return notFound();

  const access = await canReadRecording(rec, auth.user.sub);
  if (!access) return notFound();

  const lines = storedLines(rec);
  if (access === "owner") {
    const since = Math.max(0, Number(new URL(request.url).searchParams.get("since")) || 0);
    return Response.json({
      status: rec.status,
      stopRequested: rec.stopRequested,
      channels: rec.channels,
      segmentStarts: rec.segmentStarts,
      recordedSeconds: rec.recordedSeconds,
      error: rec.error,
      speakers: rec.speakers,
      total: lines.length,
      lines: lines.slice(since),
    });
  }

  return Response.json({
    status: rec.status,
    lines,
    speakers: rec.speakers,
    channels: rec.channels,
    recordedSeconds: rec.recordedSeconds,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec) return notFound();

  if (request.method === "DELETE") {
    if (rec.userId !== auth.user.sub && !(await isCore(auth.user.sub))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    await deletePrefix(rec.id);
    await prisma.meetingRecording.delete({ where: { id: rec.id } });
    return Response.json({ ok: true });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (body.action === "append") {
    return Response.json({ error: "Update the DALI OS app to record." }, { status: 410 });
  }

  // speakers and inserted are the actions any editor of the note may take;
  // everything else is owner-only.
  if (body.action === "speakers" || body.action === "inserted") {
    if (!(await canRecordInto(auth.user.sub, rec.documentName))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (body.action === "inserted") {
      await prisma.meetingRecording.update({
        where: { id: rec.id },
        data: { insertedAt: rec.insertedAt ?? new Date() },
      });
      return Response.json({ ok: true });
    }
    const patch = parseSpeakerMap(body.speakers);
    if (!patch) return Response.json({ error: "Invalid speakers" }, { status: 400 });
    await setSpeakers(rec, patch);
    return Response.json({ ok: true });
  }

  if (rec.userId !== auth.user.sub) return notFound();

  switch (body.action) {
    case "claim": {
      const result = await claimRecording(rec);
      if (!result.ok) {
        return Response.json({ error: "This recording can't be claimed." }, { status: 409 });
      }
      return Response.json({ offset: result.offset, segment: result.segment });
    }
    case "stop": {
      await requestStop(rec);
      if (body.final === true) {
        if (rec.channels.length > 0) {
          await startProcessing(rec);
        } else {
          await finalizeEmpty(rec);
        }
      }
      return Response.json({ ok: true });
    }
    case "resume":
      if (!(await resumeRecording(rec))) {
        return Response.json({ error: "This recording can't be resumed." }, { status: 409 });
      }
      return Response.json({ ok: true });
    case "finish":
      await finishRecording(
        rec,
        typeof body.error === "string" && body.error ? body.error : null,
        typeof body.seconds === "number" ? body.seconds : 0,
      );
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
