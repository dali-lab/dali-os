// MCP `mark_notification_read` — clear a notification from the caller's
// inbox/tasks. Mirrors `api.notifications.$id.read.ts` (single) and the bulk
// POST on `api.notifications.ts` (all=true). Meeting-invite notifications stay
// as todos until the recipient RSVPs; form todos stay open until their form is
// submitted (but can be force-dismissed with intent="dismiss"). Requires
// `mcp:write`.

import { prisma } from "~/lib/db";
import { isSelfClearingFormTodo, SELF_CLEARING_FORM_TODO } from "~/lib/tasks";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { ONBOARDING_EVENT_TYPE } from "~/members/lib/welcome.server";

export const MARK_NOTIFICATION_READ_TOOL = {
  name: "mark_notification_read",
  description:
    "Mark one or all of the authenticated member's notifications as read. " +
    "Pass `all: true` to bulk-clear the entire inbox (same as the web \"mark all read\" button). " +
    "For a single notification, `notificationId` is required. " +
    "Meeting invites are not cleared — use `rsvp_to_notification` for those. " +
    "Form todos only clear when their form is submitted, unless you pass `intent: \"dismiss\"` to force-clear. " +
    "Pass `intent: \"unread\"` to re-open a previously cleared notification.",
  inputSchema: {
    type: "object" as const,
    properties: {
      notificationId: {
        type: "string",
        minLength: 1,
        description:
          "Notification.id, as returned by `list_my_notifications`. Required unless `all` is true.",
      },
      all: {
        type: "boolean",
        description:
          "If true, mark ALL eligible notifications read (bulk clear). Ignores `notificationId` and `intent`.",
      },
      intent: {
        type: "string",
        enum: ["read", "unread", "dismiss"],
        description:
          '"read" (default) marks it cleared; "unread" re-opens a cleared notification; "dismiss" force-clears a form todo.',
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  notificationId?: string;
  all?: boolean;
  intent?: "read" | "unread" | "dismiss";
};

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
  | { ok: true; alreadyRead: boolean; skipped?: undefined; cleared?: undefined }
  | { ok: true; alreadyRead?: undefined; skipped: "meeting-invite" | "form-todo" | "onboarding"; cleared?: undefined }
  | { ok: true; cleared: number; alreadyRead?: undefined; skipped?: undefined };

export async function runMarkNotificationRead(
  callerId: string,
  input: Input,
): Promise<MarkNotificationReadResult> {
  // ── Bulk path: all=true ────────────────────────────────────────────────────
  // Mirrors the POST action on api.notifications.ts: marks all eligible
  // notifications read, excluding meeting invites, onboarding todos, and
  // self-clearing form todos.
  if (input.all) {
    const result = await prisma.notification.updateMany({
      where: {
        recipientUserId: callerId,
        readAt: null,
        NOT: [
          { kind: "MeetingInvite", scheduledMeetingId: { not: null } },
          { eventType: ONBOARDING_EVENT_TYPE },
          SELF_CLEARING_FORM_TODO,
        ],
      },
      data: { readAt: new Date() },
    });
    publishNotificationChange([callerId]);
    return { ok: true, cleared: result.count };
  }

  // ── Single-notification path ───────────────────────────────────────────────
  if (!input.notificationId) {
    throw new Error("notificationId is required when all is not true");
  }

  const existing = await prisma.notification.findUnique({
    where: { id: input.notificationId },
    select: {
      recipientUserId: true,
      readAt: true,
      kind: true,
      eventType: true,
      scheduledMeetingId: true,
      isTodo: true,
      form: { select: { published: true, publicToken: true } },
    },
  });
  if (!existing) throw new NotificationNotFoundError(input.notificationId);
  if (existing.recipientUserId !== callerId) throw new NotificationForbiddenError();

  const isMeetingInvite =
    existing.kind === "MeetingInvite" && !!existing.scheduledMeetingId;
  const isOnboardingTodo = existing.eventType === ONBOARDING_EVENT_TYPE;
  const isFormTodo = isSelfClearingFormTodo(existing);
  const intent = input.intent ?? "read";

  // ── unread intent: re-open a cleared notification ──────────────────────────
  // Self-clearing rows own their clear state — re-opening them is a no-op.
  if (intent === "unread") {
    if (isMeetingInvite) return { ok: true, skipped: "meeting-invite" };
    if (isOnboardingTodo) return { ok: true, skipped: "onboarding" };
    if (isFormTodo) return { ok: true, skipped: "form-todo" };
    if (!existing.readAt) return { ok: true, alreadyRead: false };
    await prisma.notification.update({
      where: { id: input.notificationId },
      data: { readAt: null },
    });
    publishNotificationChange([callerId]);
    return { ok: true, alreadyRead: false };
  }

  // ── read / dismiss intent ──────────────────────────────────────────────────
  // Meeting invites only clear via RSVP. Meeting reminders (same scheduledMeetingId
  // but kind=MeetingReminder) are dismissible like any other ping.
  if (isMeetingInvite) return { ok: true, skipped: "meeting-invite" };

  // Onboarding todo only clears when onboarding finishes.
  if (isOnboardingTodo) return { ok: true, skipped: "onboarding" };

  // Form todos only clear on form submission unless the caller explicitly
  // sends intent="dismiss" (confirmed "I won't fill this" in the UI).
  if (isFormTodo && intent !== "dismiss") {
    return { ok: true, skipped: "form-todo" };
  }

  if (existing.readAt) return { ok: true, alreadyRead: true };
  await prisma.notification.update({
    where: { id: input.notificationId },
    data: { readAt: new Date() },
  });
  publishNotificationChange([callerId]);
  return { ok: true, alreadyRead: false };
}
