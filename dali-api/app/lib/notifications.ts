// Shared notification-fetch helpers. The in-app inbox route (`api.notifications.ts`)
// and the MCP `list_my_notifications` tool both call into this module so the
// "what counts as a recent notification" policy lives in one place.

import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { EVENT_TYPES, isEventType, type EventDef } from "~/lib/notification-events";

// Invites for a Cancelled meeting are hidden everywhere — inbox, bell,
// tasks, and digest emails alike. Combine this with the per-user filter on
// every query.
export const NOT_CANCELLED_MEETING: Prisma.NotificationWhereInput = {
  OR: [
    { scheduledMeetingId: null },
    { scheduledMeeting: { status: { not: "Cancelled" } } },
  ],
};

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
  const where: Prisma.NotificationWhereInput = {
    recipientUserId: userId,
    ...(opts.onlyUnread ? { readAt: null } : {}),
    ...NOT_CANCELLED_MEETING,
  };

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { recipientUserId: userId, readAt: null, ...NOT_CANCELLED_MEETING },
    }),
  ]);

  return { items, unreadCount };
}

export type DesktopPrefRow = { eventType: string; desktop: boolean };

/**
 * Desktop-app annotations for feed items: `desktop` — should this item raise a
 * native banner (per-event preference, registry default when no row) — and
 * `urgent` — the registry's timeSensitive flag. Resolved at read time for the
 * same reason preferences aren't stamped on rows: a preference change must
 * apply to rows the app hasn't surfaced yet.
 */
export function annotateDesktopFeed<T extends { eventType: string }>(
  items: T[],
  prefs: DesktopPrefRow[],
): (T & { desktop: boolean; urgent: boolean })[] {
  const desktopByType = new Map(prefs.map((p) => [p.eventType, p.desktop]));
  return items.map((item) => {
    const def: EventDef = isEventType(item.eventType)
      ? EVENT_TYPES[item.eventType]
      : EVENT_TYPES.general;
    return {
      ...item,
      desktop: desktopByType.get(item.eventType) ?? def.defaults.desktop,
      urgent: def.timeSensitive === true,
    };
  });
}
