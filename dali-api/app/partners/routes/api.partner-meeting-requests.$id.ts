import type { Route } from "./+types/api.partner-meeting-requests.$id";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { respondToMeetingRequest } from "~/partners/lib/partner-meetings.server";

// POST /api/partner-meeting-requests/:id
//
// Core accepts or declines a partner's self-service meeting request. Body:
// { action: "accept" | "decline", note? }. Accept still schedules the meeting
// when a participant has gone busy since the request was made — the response
// flags it as a conflict rather than blocking.

const Schema = z.object({
  action: z.enum(["accept", "decline"]),
  note: z.string().trim().max(2000).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  const result = await respondToMeetingRequest({
    requestId: params.id,
    actorUserId: auth.user.sub,
    action: body.action,
    note: body.note,
  });
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: 400 }));
  }

  return withCors(
    request,
    Response.json({
      ok: true,
      ...(result.conflict ? { conflict: true, busyUserIds: result.busyUserIds } : {}),
    }),
  );
}
