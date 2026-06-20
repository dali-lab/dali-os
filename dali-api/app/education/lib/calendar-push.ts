import { prisma } from "~/lib/db";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  patchGoogleCalendarEvent,
} from "~/lib/google-calendar";

/**
 * Resolve the `UserCalendarLink.id` to use for an offering's calendar
 * identity. Returns null when the offering has no `calendarEmail` set or no
 * matching link exists. We don't gate by user — education calendars are
 * workspace-level identities, owned by whoever authorized them originally.
 */
async function resolveLinkId(offeringId: string): Promise<string | null> {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    select: { calendarEmail: true },
  });
  if (!offering?.calendarEmail) return null;
  const link = await prisma.userCalendarLink.findFirst({
    where: { provider: "Google", enabled: true, externalEmail: offering.calendarEmail },
    select: { id: true },
  });
  return link?.id ?? null;
}

/**
 * Best-effort push of an EducationSession to a Google Calendar identified
 * by `offering.calendarEmail` → matching `UserCalendarLink`. No-ops if
 * `calendarEmail` isn't set or no link is connected. Returns the new
 * `calendarEventId` (or null if nothing was pushed). Idempotent: returns
 * the existing event id without re-inserting if already pushed.
 */
export async function pushSessionToCalendar(sessionId: string): Promise<string | null> {
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    include: {
      offering: { select: { id: true, title: true, calendarEmail: true } },
    },
  });
  if (!session) return null;
  if (session.calendarEventId) return session.calendarEventId;
  if (!session.offering.calendarEmail) return null;

  const linkId = await resolveLinkId(session.offering.id);
  if (!linkId) return null;

  const start = session.datetime;
  const end = new Date(start.getTime() + session.durationMinutes * 60_000);

  try {
    const { eventId } = await createGoogleCalendarEvent({
      linkId,
      summary: `${session.offering.title} — Session ${session.sequence}`,
      description: session.location ? `Location: ${session.location}` : undefined,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: [],
    });
    await prisma.educationSession.update({
      where: { id: session.id },
      data: { calendarEventId: eventId },
    });
    return eventId;
  } catch (err) {
    console.error("[education] calendar push failed:", err);
    return null;
  }
}

/**
 * Patch the Google Calendar event for a session after its datetime,
 * location, sequence, or duration has changed. No-op if the session was
 * never pushed. Recreates the event if Google reports it as gone (404/410).
 */
export async function patchSessionCalendarEvent(sessionId: string): Promise<string | null> {
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    include: { offering: { select: { id: true, title: true } } },
  });
  if (!session) return null;
  if (!session.calendarEventId) {
    // Never pushed yet — try a fresh insert (e.g. calendarEmail was set
    // after the session was added).
    return pushSessionToCalendar(sessionId);
  }
  const linkId = await resolveLinkId(session.offering.id);
  if (!linkId) return session.calendarEventId;

  const start = session.datetime;
  const end = new Date(start.getTime() + session.durationMinutes * 60_000);

  try {
    await patchGoogleCalendarEvent({
      linkId,
      eventId: session.calendarEventId,
      summary: `${session.offering.title} — Session ${session.sequence}`,
      description: session.location ? `Location: ${session.location}` : "",
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    });
    return session.calendarEventId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Stale event id — drop the local link and try a fresh insert.
    if (message.includes("404") || message.includes("410")) {
      await prisma.educationSession.update({
        where: { id: session.id },
        data: { calendarEventId: null },
      });
      return pushSessionToCalendar(sessionId);
    }
    console.error("[education] calendar patch failed:", err);
    return session.calendarEventId;
  }
}

/**
 * Delete the Google Calendar event for a session. Safe to call when the
 * session was never pushed. Returns true if an event was actually deleted
 * (or was already gone), false if there was nothing to do.
 */
export async function deleteSessionCalendarEvent(sessionId: string): Promise<boolean> {
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    select: {
      calendarEventId: true,
      offering: { select: { id: true } },
    },
  });
  if (!session?.calendarEventId) return false;
  const linkId = await resolveLinkId(session.offering.id);
  if (!linkId) return false;
  try {
    await deleteGoogleCalendarEvent({ linkId, eventId: session.calendarEventId });
    return true;
  } catch (err) {
    console.error("[education] calendar delete failed:", err);
    return false;
  }
}
