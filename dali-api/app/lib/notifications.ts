// Shared notification-fetch helpers. The in-app inbox route (`api.notifications.ts`)
// and the MCP `list_my_notifications` tool both call into this module so the
// "what counts as a recent notification" policy lives in one place.

import { prisma } from "~/lib/db";
import type { NotificationKind } from "~/generated/prisma/enums";

export interface ListNotificationsOptions {
  /** Hard cap on rows returned. */
  limit?: number;
  /** When true, only return notifications with readAt = null. */
  onlyUnread?: boolean;
}

export interface NotificationListResult {
  items: Awaited<ReturnType<typeof prisma.notification.findMany>>;
  unreadCount: number;
}

/**
 * Load the inbox view for a user: a slice of recent notifications plus the
 * total unread count. Default slice mirrors the in-app inbox (last 50,
 * newest first).
 */
export async function listMyNotifications(
  userId: string,
  opts: ListNotificationsOptions = {},
): Promise<NotificationListResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 50));
  const where = opts.onlyUnread
    ? { recipientUserId: userId, readAt: null }
    : { recipientUserId: userId };

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { recipientUserId: userId, readAt: null },
    }),
  ]);

  return { items, unreadCount };
}

// ─── Event emission ──────────────────────────────────────────────────────────
//
// `emitEvent` is the producer side of the notification pipeline. Writes one
// NotificationEvent row per recipient (the canonical event log) and, when an
// in-app inbox surface is configured, one Notification row per recipient
// (the interactive bell). They will be reconciled when the unified delivery
// track ships; until then producers should call this and move on.

export interface EmitEventInput {
  type: string;
  recipients: string[];
  payload: Record<string, unknown>;
  inbox?: {
    kind: NotificationKind;
    title: string;
    body?: string | null;
    link?: string | null;
    createdByUserId?: string | null;
  };
}

export interface EmitEventResult {
  eventsWritten: number;
  notificationsWritten: number;
}

export async function emitEvent(input: EmitEventInput): Promise<EmitEventResult> {
  const recipients = Array.from(new Set(input.recipients.filter(Boolean)));
  if (recipients.length === 0) {
    return { eventsWritten: 0, notificationsWritten: 0 };
  }

  const eventResult = await prisma.notificationEvent.createMany({
    data: recipients.map((recipientId) => ({
      type: input.type,
      recipientId,
      payload: input.payload as object,
    })),
  });

  let notificationsWritten = 0;
  if (input.inbox) {
    const inbox = input.inbox;
    const notifResult = await prisma.notification.createMany({
      data: recipients.map((recipientUserId) => ({
        recipientUserId,
        createdByUserId: inbox.createdByUserId ?? null,
        kind: inbox.kind,
        title: inbox.title,
        body: inbox.body ?? null,
        link: inbox.link ?? null,
      })),
    });
    notificationsWritten = notifResult.count;
  }

  return {
    eventsWritten: eventResult.count,
    notificationsWritten,
  };
}
