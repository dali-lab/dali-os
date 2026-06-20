import type { Route } from "./+types/api.offerings.$id.sessions";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { addSession } from "~/education/lib/offerings-data";
import { pushSessionToCalendar } from "~/education/lib/calendar-push";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.datetime || body.sequence === undefined) {
    return Response.json({ error: "datetime and sequence are required" }, { status: 400 });
  }

  const created = await addSession(params.id, {
    sequence: Number(body.sequence),
    datetime: new Date(body.datetime),
    location: body.location ?? null,
    materialsDocId: body.materialsDocId ?? null,
    recordingUrl: body.recordingUrl ?? null,
  });

  await logAuditEvent({
    action: "education.session.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { offeringId: params.id },
    request,
  });

  // Fire-and-forget: push to Google Calendar if the offering has an
  // associated calendar identity. Failure is logged inside the helper.
  let calendarEventId: string | null = null;
  try {
    calendarEventId = await pushSessionToCalendar(created.id);
    if (calendarEventId) {
      await logAuditEvent({
        action: "education.session.calendar_push",
        userId: auth.user.sub,
        targetId: created.id,
        metadata: { eventId: calendarEventId },
        request,
      });
    }
  } catch (err) {
    console.error("[education] calendar push attempt failed:", err);
  }

  return Response.json({ ...created, calendarEventId }, { status: 201 });
}
