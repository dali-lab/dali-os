// /api/meeting-recordings/:id — one native recording, owner-only (anyone else
// gets a 404). Used by two clients with different credentials:
//   - The page (cookie session): GET to poll the transcript, POST
//     {action:"stop"} for its Stop button and {action:"resume"} for Continue,
//     DELETE once the notes are written or the recording is discarded.
//   - The desktop app (desktop Session Bearer): POST {action:"append", lines,
//     systemAudio} as phrases are recognized (the reply says whether the page
//     asked to stop, and the offset to stamp lines from), then
//     {action:"finish", error?, seconds} when the recorder exits.
// The app's first append doubles as its check that the link it was handed is
// really this user's recording: it won't open the microphone on a 404.
//
// NEVER log transcript text.

import type { Route } from "./+types/api.meeting-recordings.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  appendLines,
  cleanLines,
  finishRecording,
  ownRecording,
  requestStop,
  resumeRecording,
  storedLines,
} from "~/lib/meeting-recording.server";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await ownRecording(params.id, auth.user.sub);
  if (!rec) return notFound();

  // `since` lets the page fetch only lines it hasn't seen.
  const since = Math.max(0, Number(new URL(request.url).searchParams.get("since")) || 0);
  const lines = storedLines(rec);
  return Response.json({
    status: rec.status,
    systemAudio: rec.systemAudio,
    recordedSeconds: rec.recordedSeconds,
    error: rec.error,
    total: lines.length,
    lines: lines.slice(since),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const rec = await ownRecording(params.id, auth.user.sub);
  if (!rec) return notFound();

  if (request.method === "DELETE") {
    await prisma.meetingRecording.delete({ where: { id: rec.id } });
    return Response.json({ ok: true });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  switch (body.action) {
    case "append": {
      const systemAudio = typeof body.systemAudio === "boolean" ? body.systemAudio : undefined;
      return Response.json(await appendLines(rec, cleanLines(body.lines), systemAudio));
    }
    case "stop":
      await requestStop(rec);
      return Response.json({ ok: true });
    case "resume":
      if (!(await resumeRecording(rec))) {
        return Response.json({ error: "This recording is still running." }, { status: 409 });
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
