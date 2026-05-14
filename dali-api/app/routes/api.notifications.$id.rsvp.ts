import type { Route } from "./+types/api.notifications.$id.rsvp";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { updateGoogleAttendeeRsvp } from "~/lib/google-calendar";

const Schema = z.object({
  response: z.enum(["accepted", "declined", "tentative"]),
});

const RSVP_TO_ENUM = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
} as const;

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, Schema);
  if (body instanceof Response) return withCors(request, body);

  const id = params.id!;
  const notif = await prisma.notification.findUnique({
    where: { id },
    select: {
      id: true,
      recipientUserId: true,
      scheduledMeetingId: true,
      scheduledMeeting: {
        select: {
          externalEventId: true,
          organizerCalendarLinkId: true,
        },
      },
    },
  });
  if (!notif) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (notif.recipientUserId !== auth.user.sub) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  if (!notif.scheduledMeetingId) {
    return withCors(request, Response.json({ error: "Notification has no associated meeting" }, { status: 400 }));
  }

  // Resolve the recipient's invite email (matches what we sent to Google).
  const recipient = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { daliEmail: true, dartmouthEmail: true },
  });
  const attendeeEmail = recipient?.daliEmail ?? recipient?.dartmouthEmail ?? auth.user.email;

  // Best-effort: push the RSVP to Google. If the meeting wasn't pushed to GCal
  // (no externalEventId or no organizer link), we still record the in-app RSVP.
  let gcalError: string | null = null;
  if (
    notif.scheduledMeeting?.externalEventId &&
    notif.scheduledMeeting.organizerCalendarLinkId &&
    attendeeEmail
  ) {
    try {
      await updateGoogleAttendeeRsvp({
        linkId: notif.scheduledMeeting.organizerCalendarLinkId,
        eventId: notif.scheduledMeeting.externalEventId,
        attendeeEmail,
        response: body.response,
      });
    } catch (err) {
      gcalError = err instanceof Error ? err.message : "Google RSVP push failed";
    }
  }

  await prisma.notification.update({
    where: { id },
    data: {
      rsvp: RSVP_TO_ENUM[body.response],
      rsvpAt: new Date(),
      readAt: new Date(),
    },
  });

  return withCors(request, Response.json({ ok: true, gcalError }));
}
