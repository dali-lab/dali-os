// POST /api/meeting-recordings/:id/result — Modal's callback once a
// transcription job finishes. No session: verified by HMAC
// (X-Dali-Timestamp / X-Dali-Signature, see transcription/hmac.ts) instead.
// Idempotent — see applyResult.
//
// NEVER log the raw body (it's the transcript) or DIARIZE_SECRET.

import type { Route } from "./+types/api.meeting-recordings.$id.result";
import { prisma } from "~/lib/db.server";
import { verifyHmac } from "~/lib/transcription/hmac";
import { applyResult } from "~/lib/meeting-recording.server";
import type { ModalCallbackBody, ModalProgress, ModalProgressBody } from "~/lib/transcription/modal";

const PROGRESS_STAGES = ["fetching", "transcribing", "labeling"];

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseProgress(raw: unknown): ModalProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.stage !== "string" || !PROGRESS_STAGES.includes(p.stage)) return null;
  if (!isCount(p.channel) || !isCount(p.channels) || !isCount(p.completed) || !isCount(p.total)) return null;
  if (p.channel < 1 || p.channels < 1 || p.channel > p.channels || p.completed > p.total) return null;
  if (typeof p.audioSeconds !== "number" || !Number.isFinite(p.audioSeconds) || p.audioSeconds < 0) return null;
  return {
    stage: p.stage as ModalProgress["stage"],
    channel: p.channel,
    channels: p.channels,
    completed: p.completed,
    total: p.total,
    audioSeconds: p.audioSeconds,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = process.env.DIARIZE_SECRET;
  if (!secret) return Response.json({ error: "Not available" }, { status: 503 });

  const rawBody = await request.text();
  const verified = verifyHmac({
    secret,
    timestamp: request.headers.get("x-dali-timestamp"),
    signature: request.headers.get("x-dali-signature"),
    rawBody,
  });
  if (!verified) return Response.json({ error: "Invalid signature" }, { status: 401 });

  let body: ModalCallbackBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || body.recordingId !== params.id) {
    return Response.json({ error: "recordingId mismatch" }, { status: 400 });
  }

  if ("progress" in body) {
    const progress = parseProgress((body as unknown as ModalProgressBody).progress);
    if (!progress) return Response.json({ error: "Invalid progress" }, { status: 400 });
    await prisma.meetingRecording.updateMany({
      where: { id: params.id, status: "Processing" },
      data: { progress },
    });
    return Response.json({ ok: true });
  }

  const rec = await prisma.meetingRecording.findUnique({ where: { id: params.id } });
  if (!rec) return Response.json({ error: "Not found" }, { status: 404 });

  await applyResult(rec, { channels: body.channels ?? {}, error: body.error ?? null });
  return Response.json({ ok: true });
}
