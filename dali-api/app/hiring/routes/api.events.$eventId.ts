import type { Route } from "./+types/api.events.$eventId";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { getUserRoles, isCycleAdmin } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson, idSchema, nullableTrimmed } from "~/lib/validate";
import {
  deleteHiringEvent,
  getEventRoster,
  markEventAttendance,
  setEventCheckInOpen,
  updateHiringEvent,
} from "~/hiring/lib/hiring-events.server";
import { sendEventAnnouncement } from "~/hiring/lib/hiring-event-notice";

// GET returns the roster (gated here — getEventRoster itself doesn't gate).
// POST dispatches on `intent`: update | delete | set-check-in |
// send-announcement | mark-attendance. `intent` is OPTIONAL and defaults to
// "mark-attendance" when the body is just `{ userId, present }` — that's the
// bare shape AttendanceChecklist and the walk-in Combobox already post (see
// ApplicationEventsCard), so this route has to accept it without a wrapper.
// Every other mutation gate lives in the lib (isCycleAdmin); send-announcement
// doesn't gate itself, so this route gates it directly.

const ActionBodySchema = z.object({
  intent: z.enum(["update", "delete", "set-check-in", "send-announcement", "mark-attendance"]).optional(),
  kind: z.enum(["HelpHour", "Social", "InfoSession", "Other"]).optional(),
  title: z.string().min(1).optional(),
  startsAt: z.string().min(1).optional(),
  endsAt: z.string().min(1).optional(),
  location: nullableTrimmed.optional(),
  open: z.boolean().optional(),
  userId: idSchema.optional(),
  present: z.boolean().optional(),
  // Sent by AttendanceChecklist for occurrence-scoped meetings; this route
  // doesn't scope attendance by occurrence, so it's accepted and ignored.
  occurrence: z.string().optional(),
});

async function requireFlag(request: Request, userId: string): Promise<Response | null> {
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("application-events", userId, roles, request))) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  return null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const flagResponse = await requireFlag(request, auth.user.sub);
  if (flagResponse) return flagResponse;

  const event = await prisma.hiringEvent.findUnique({
    where: { id: params.eventId },
    select: { applicationCycleId: true },
  });
  if (!event) return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));

  if (!(await isCycleAdmin(auth.user.sub, event.applicationCycleId))) return forbidden(request);

  const roster = await getEventRoster(params.eventId!);
  return withCors(request, Response.json(roster));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const flagResponse = await requireFlag(request, auth.user.sub);
  if (flagResponse) return flagResponse;

  const body = await parseJson(request, ActionBodySchema);
  if (body instanceof Response) return withCors(request, body);

  const eventId = params.eventId!;
  const actorId = auth.user.sub;
  const intent =
    body.intent ?? (body.userId !== undefined && body.present !== undefined ? "mark-attendance" : null);

  switch (intent) {
    case "update": {
      const result = await updateHiringEvent({
        eventId,
        actorId,
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
      });
      if ("error" in result) {
        return withCors(request, Response.json({ error: result.error }, { status: result.status }));
      }
      return withCors(request, Response.json(result.event));
    }
    case "delete": {
      const result = await deleteHiringEvent({ eventId, actorId });
      if ("error" in result) {
        return withCors(request, Response.json({ error: result.error }, { status: result.status }));
      }
      return withCors(request, Response.json({ ok: true }));
    }
    case "set-check-in": {
      if (body.open === undefined) {
        return withCors(request, Response.json({ error: "Missing 'open'" }, { status: 400 }));
      }
      const result = await setEventCheckInOpen({ eventId, open: body.open, actorId });
      if ("error" in result) {
        return withCors(request, Response.json({ error: result.error }, { status: result.status }));
      }
      return withCors(request, Response.json({ ok: true }));
    }
    case "mark-attendance": {
      if (body.userId === undefined || body.present === undefined) {
        return withCors(request, Response.json({ error: "Missing 'userId'/'present'" }, { status: 400 }));
      }
      const result = await markEventAttendance({ eventId, actorId, userId: body.userId, present: body.present });
      if ("error" in result) {
        return withCors(request, Response.json({ error: result.error }, { status: result.status }));
      }
      return withCors(request, Response.json({ ok: true }));
    }
    case "send-announcement": {
      const event = await prisma.hiringEvent.findUnique({
        where: { id: eventId },
        select: { applicationCycleId: true },
      });
      if (!event) return withCors(request, Response.json({ error: "Event not found" }, { status: 404 }));
      if (!(await isCycleAdmin(actorId, event.applicationCycleId))) return forbidden(request);

      const result = await sendEventAnnouncement(eventId, actorId);
      return withCors(request, Response.json(result));
    }
    default:
      return withCors(request, Response.json({ error: "Unknown intent" }, { status: 400 }));
  }
}
