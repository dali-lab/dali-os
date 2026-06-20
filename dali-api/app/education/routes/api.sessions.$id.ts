import type { Route } from "./+types/api.sessions.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { deleteSession, updateSession } from "~/education/lib/offerings-data";
import {
  deleteSessionCalendarEvent,
  patchSessionCalendarEvent,
} from "~/education/lib/calendar-push";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const session = await prisma.educationSession.findUnique({ where: { id: params.id } });
  if (!session) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageOffering(auth.user.sub, session.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.method === "DELETE") {
    // Pull the event off Google before the row goes away.
    try {
      await deleteSessionCalendarEvent(params.id);
    } catch (err) {
      console.error("[education] calendar delete attempt failed:", err);
    }
    await deleteSession(params.id);
    await logAuditEvent({ action: "education.session.delete", userId: auth.user.sub, targetId: params.id, request });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const patch: Parameters<typeof updateSession>[1] = {};
  if (body.sequence !== undefined) patch.sequence = Number(body.sequence);
  if (body.datetime !== undefined) patch.datetime = new Date(body.datetime);
  if (body.location !== undefined) patch.location = body.location;
  if (body.materialsDocId !== undefined) patch.materialsDocId = body.materialsDocId;
  if (body.recordingUrl !== undefined) patch.recordingUrl = body.recordingUrl;

  const updated = await updateSession(params.id, patch);
  await logAuditEvent({ action: "education.session.update", userId: auth.user.sub, targetId: params.id, request });

  // Fire-and-forget: propagate the change to Google Calendar.
  try {
    const eventId = await patchSessionCalendarEvent(params.id);
    if (eventId) {
      await logAuditEvent({
        action: "education.session.calendar_push",
        userId: auth.user.sub,
        targetId: params.id,
        metadata: { eventId, op: "patch" },
        request,
      });
    }
  } catch (err) {
    console.error("[education] calendar patch attempt failed:", err);
  }

  return Response.json(updated);
}
