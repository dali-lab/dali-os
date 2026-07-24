// MCP `mark_notification_read` — clear a notification from the caller's
// inbox/tasks. Mirrors `api.notifications.$id.read.ts`: a meeting-invite
// notification stays a todo until the recipient RSVPs (so plain "read" is a
// no-op for those), matching the in-app behavior. Requires the `mcp:write`
// scope.

import { prisma } from "~/lib/db";

export const MARK_NOTIFICATION_READ_TOOL = {
  name: "mark_notification_read",
  description:
    "Mark one of the authenticated member's notifications as read. Meeting invites are not cleared by this — use `rsvp_to_notification` for those.",
  inputSchema: {
    type: "object" as const,
    properties: {
      notificationId: {
        type: "string",
        minLength: 1,
        description: "Notification.id, as returned by `list_my_notifications`.",
      },
    },
    required: ["notificationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { notificationId: string };

export class NotificationNotFoundError extends Error {
  constructor(id: string) {
    super(`Notification ${id} not found`);
    this.name = "NotificationNotFoundError";
  }
}

export class NotificationForbiddenError extends Error {
  constructor() {
    super("Notification belongs to another user");
    this.name = "NotificationForbiddenError";
  }
}

export type MarkNotificationReadResult =
  | { ok: true; alreadyRead: boolean; skipped?: undefined }
  | { ok: true; alreadyRead?: undefined; skipped: "meeting-invite" };

export async function runMarkNotificationRead(
  callerId: string,
  input: Input,
): Promise<MarkNotificationReadResult> {
  const existing = await prisma.notification.findUnique({
    where: { id: input.notificationId },
    select: {
      recipientUserId: true,
      readAt: true,
      kind: true,
      scheduledMeetingId: true,
    },
  });
  if (!existing) throw new NotificationNotFoundError(input.notificationId);
  if (existing.recipientUserId !== callerId) throw new NotificationForbiddenError();

  // Mirror api.notifications.$id.read.ts: meeting invites only clear via RSVP.
  // Meeting reminders also have scheduledMeetingId but are dismissible.
  if (existing.kind === "MeetingInvite" && existing.scheduledMeetingId) {
    return { ok: true, skipped: "meeting-invite" };
  }

  if (existing.readAt) return { ok: true, alreadyRead: true };
  await prisma.notification.update({
    where: { id: input.notificationId },
    data: { readAt: new Date() },
  });
  return { ok: true, alreadyRead: false };
}
