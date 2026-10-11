// POST /api/ai/meeting-notes/enhance — specs/meeting-notes-model.md §2.
// Takes the note's current top-level blocks (as the enhancer's own editor
// sees them) plus the recording's transcript and roster, asks Claude Sonnet
// 5 for a block-keyed merge plan, verifies every citation and inserted block
// against the real transcript, resolves owner names to roster user ids, and
// stores the verified plan on the recording. Nothing past verifyEnhancePlan
// is trusted model output.
//
// Same flag gate, permission check, and per-user burst/daily budget as
// api/ai/meeting-notes (Write notes) — Enhance replaces that button once
// someone has typed, so it draws on the same quota rather than a second one.
//
// NEVER log the transcript, the note's text, or the model's raw response.

import type { Route } from "./+types/api.ai.meeting-notes.enhance";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto } from "~/lib/meeting-recording.server";
import { getUserRoles } from "~/lib/roles";
import { checkRateLimit } from "~/lib/rate-limit";
import { parseJson } from "~/lib/validate";
import { prisma } from "~/lib/db";
import { generateAndVerifyEnhancePlan, EnhanceBlocksSchema } from "~/lib/meeting-notes-enhance.server";
import { AI_BURST_MAX, AI_BURST_WINDOW_MS } from "./api.ai.meeting-notes";

const RequestSchema = z.object({
  recordingId: z.string().min(1),
  blocks: EnhanceBlocksSchema,
  untouchedTemplate: z.boolean(),
});

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const burstLimited = checkRateLimit(
    request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-meeting-notes:${auth.user.sub}`,
  );
  if (burstLimited) {
    const retryAfter = burstLimited.headers.get("Retry-After") ?? "60";
    return Response.json(
      { error: `Too many requests. Try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  const body = await parseJson(request, RequestSchema);
  if (body instanceof Response) return body;

  const rec = await prisma.meetingRecording.findUnique({ where: { id: body.recordingId } });
  if (!rec) return Response.json({ error: "Recording not found" }, { status: 404 });

  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("ai-meeting-notes", auth.user.sub, roles, request))) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }
  if (!(await canRecordInto(auth.user.sub, rec.documentName))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await generateAndVerifyEnhancePlan({
    rec,
    blocks: body.blocks,
    untouchedTemplate: body.untouchedTemplate,
    userId: auth.user.sub,
  });
  if (!result.ok) {
    if ("aiEnabled" in result) return Response.json({ aiEnabled: false }, { status: 503 });
    return Response.json(
      { error: result.error },
      result.retryAfterSeconds !== undefined
        ? { status: result.status, headers: { "Retry-After": String(result.retryAfterSeconds) } }
        : { status: result.status },
    );
  }

  return Response.json(result.notes);
}
