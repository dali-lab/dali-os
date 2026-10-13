import type { Route } from "./+types/api.pages.$id.meeting";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { attachNote, detachNote, notebookErrorResponse } from "~/lib/notebooks.server";

// POST /api/pages/:id/meeting
//   { intent: "detach-meeting" }                             — a meeting note becomes a plain doc
//   { intent: "attach-meeting", meetingId, occurrenceStart? } — a plain doc becomes that occurrence's note

const BodySchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("detach-meeting") }),
  z.object({
    intent: z.literal("attach-meeting"),
    meetingId: z.string().min(1),
    occurrenceStart: z.string().datetime().nullable().optional(),
  }),
]);

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const actorId = gate.auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    if (body.intent === "detach-meeting") {
      await detachNote(params.id!, actorId);
      return withCors(request, Response.json({ ok: true }));
    }
    const result = await attachNote(
      params.id!,
      body.meetingId,
      body.occurrenceStart ? new Date(body.occurrenceStart) : null,
      actorId,
    );
    return withCors(request, Response.json({ ok: true, ...result }));
  } catch (err) {
    return withCors(request, notebookErrorResponse(err));
  }
}
