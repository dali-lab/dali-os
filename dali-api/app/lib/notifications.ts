// Shared notification-fetch helpers. The in-app inbox route (`api.notifications.ts`)
// and the MCP `list_my_notifications` tool both call into this module so the
// "what counts as a recent notification" policy lives in one place.

import { prisma } from "~/lib/db";

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
