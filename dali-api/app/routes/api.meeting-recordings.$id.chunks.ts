// POST /api/meeting-recordings/:id/chunks — one 20s PCM chunk. Owner-only,
// raw body (no JSON wrapper): Content-Length is checked before the body is
// read, content type must be audio/pcm, and channel/segment/seq come from
// the query string. Same-seq re-upload (a retry after a lost 2xx) is
// idempotent — the S3 key is the same, so it's just an overwrite.
//
// NEVER log chunk bytes.

import type { Route } from "./+types/api.meeting-recordings.$id.chunks";
import { requireAuth } from "~/lib/auth";
import { ownRecording, recordChunk } from "~/lib/meeting-recording.server";
import { putChunk } from "~/lib/transcription/chunks.server";

// 20s of 16kHz mono s16 PCM is ~640KB; cap with headroom.
const MAX_CHUNK_BYTES = 700_000;
// 4 hours per segment (seq 0..720 at 20s each), 20 segments (Continue count).
const MAX_SEQ = 720;
const MAX_SEGMENT = 20;

const TERMINAL_STATUSES = new Set(["Processing", "Done", "Failed"]);

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_CHUNK_BYTES) {
    return Response.json({ error: "Chunk too large" }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/pcm")) {
    return Response.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const segment = Number(url.searchParams.get("segment"));
  const seq = Number(url.searchParams.get("seq"));
  if (channel !== "mic" && channel !== "call") {
    return Response.json({ error: "Invalid channel" }, { status: 400 });
  }
  if (!Number.isInteger(segment) || segment < 0 || segment > MAX_SEGMENT) {
    return Response.json({ error: "Invalid segment" }, { status: 400 });
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    return Response.json({ error: "Invalid seq" }, { status: 400 });
  }

  const rec = await ownRecording(params.id, auth.user.sub);
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });
  if (rec.finalizedAt !== null || TERMINAL_STATUSES.has(rec.status)) {
    return Response.json({ error: "Recording has ended" }, { status: 409 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_CHUNK_BYTES) {
    return Response.json({ error: "Chunk too large" }, { status: 413 });
  }

  await putChunk(rec.id, channel, segment, seq, body);
  const { stopRequested } = await recordChunk(rec, channel, segment, seq);

  // lines/behindSeconds are reserved for the live-transcript follow-up so the
  // client contract doesn't change when that ships.
  return Response.json({ stopRequested, behindSeconds: 0, lines: [] });
}
