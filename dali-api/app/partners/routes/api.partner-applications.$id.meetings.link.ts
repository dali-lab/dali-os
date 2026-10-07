import type { Route } from "./+types/api.partner-applications.$id.meetings.link";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { linkScheduledMeetingToApplication } from "~/partners/lib/partner-meetings.server";

// POST /api/partner-applications/:id/meetings/link
//
// Links a just-created ScheduledMeeting (Core's scheduler, via
// ScheduleInterviewModal's onCreated) back to a partner application as the
// CRM's PartnerMeeting row. Body: { scheduledMeetingId }.

const Schema = z.object({ scheduledMeetingId: z.string().min(1) });

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

  const result = await linkScheduledMeetingToApplication({
    applicationId: params.id,
    scheduledMeetingId: body.scheduledMeetingId,
    actorUserId: auth.user.sub,
  });
  if (!result) {
    return withCors(request, Response.json({ error: "Application or meeting not found" }, { status: 404 }));
  }

  return withCors(request, Response.json({ ok: true }));
}
