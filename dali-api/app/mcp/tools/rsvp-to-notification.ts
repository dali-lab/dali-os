// MCP `rsvp_to_notification` — accept / decline / tentatively-accept a
// MeetingInvite notification. Mirrors `api.notifications.$id.rsvp.ts`,
// including the best-effort Google Calendar attendee response push. Requires
// the `mcp:write` scope.

import { prisma } from "~/lib/db";
import { updateGoogleAttendeeRsvp } from "~/lib/google-calendar";
import { primaryEmail } from "~/lib/display";

export const RSVP_TO_NOTIFICATION_TOOL = {
  name: "rsvp_to_notification",
  description:
    "Respond to a meeting-invite notification (accepted/declined/tentative). Records the RSVP, marks the notification read, and best-effort pushes the response to Google Calendar when the meeting was pushed there.",
  inputSchema: {
    type: "object" as const,
    properties: {
      notificationId: {
        type: "string",
        minLength: 1,
        description: "Notification.id of a MeetingInvite, from `list_my_notifications`.",
      },
      response: {
        type: "string",
        enum: ["accepted", "declined", "tentative"],
        description: "The RSVP response to record.",
      },
    },
    required: ["notificationId", "response"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { notificationId: string; response: "accepted" | "declined" | "tentative" };

const RSVP_TO_ENUM = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentative",
} as const;

export class RsvpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "RsvpError";
  }
}

export async function runRsvpToNotification(
  caller: { id: string; daliEmail: string | null; dartmouthEmail: string | null },
  input: Input,
) {
  const notif = await prisma.notification.findUnique({
    where: { id: input.notificationId },
    select: {
      id: true,
      recipientUserId: true,
      scheduledMeetingId: true,
      scheduledMeeting: {
        select: { externalEventId: true, organizerCalendarLinkId: true },
      },
    },
  });
  if (!notif) throw new RsvpError("Notification not found", 404);
  if (notif.recipientUserId !== caller.id) throw new RsvpError("Forbidden", 403);
  if (!notif.scheduledMeetingId) {
    throw new RsvpError("Notification has no associated meeting", 400);
  }

  const attendeeEmail = primaryEmail(caller);

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
        response: input.response,
      });
    } catch (err) {
      gcalError = err instanceof Error ? err.message : "Google RSVP push failed";
    }
  }

  await prisma.notification.update({
    where: { id: input.notificationId },
    data: {
      rsvp: RSVP_TO_ENUM[input.response],
      rsvpAt: new Date(),
      readAt: new Date(),
    },
  });

  return { ok: true, gcalError };
}
