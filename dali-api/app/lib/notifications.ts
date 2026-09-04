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

// "Starting soon" reminders stamp dueAt to the occurrence start. Once that
// time has passed the ping is stale — hide it from live surfaces. Pre-stamp
// reminders with null dueAt fall back to the meeting's selectedAt so
// already-started one-offs clear without a manual dismiss.
const notExpiredMeetingReminder = (now: Date): Prisma.NotificationWhereInput => ({
  OR: [
    { kind: { not: "MeetingReminder" } },
    { dueAt: { gt: now } },
    {
      AND: [
        { dueAt: null },
        {
          OR: [
            { scheduledMeeting: { selectedAt: { gt: now } } },
            { scheduledMeeting: { selectedAt: null } },
          ],
        },
      ],
    },
  ],
});

// An un-RSVP'd invite to a meeting that has already happened is no longer
// something anyone can act on, so it hides itself rather than sitting in the
// feed forever waiting for an answer the meeting no longer needs. Only
// one-offs: a recurring series' selectedAt is its *first* occurrence, and
// future ones are still worth answering. A meeting still in Searching has no
// time yet (selectedAt null) and stays open.
const notPastMeetingInvite = (now: Date): Prisma.NotificationWhereInput => ({
  OR: [
    { kind: { not: "MeetingInvite" } },
    { scheduledMeetingId: null },
    { scheduledMeeting: { recurrenceRule: { not: null } } },
    { scheduledMeeting: { selectedAt: null } },
    { scheduledMeeting: { selectedAt: { gt: now } } },
  ],
});

/**
 * Staleness hides for meeting-backed notifications that are still awaiting
 * action, as AND clauses. Both read paths build on this — the tasks path
 * (listOpenTasks/countOpenTasks, which drives the web bell's `taskCount`) and
 * the inbox path (listMyNotifications, which drives the desktop app's feed and
 * dock badge) — so the two counts can't disagree.
 *
 * Only meaningful for unread rows: a row the user has already read is plain
 * history. History (listNotificationHistory) applies none of these and
 * annotates the rows via resolveNotificationState instead.
 */
export function liveMeetingPingClauses(now: Date): Prisma.NotificationWhereInput[] {
  return [notExpiredMeetingReminder(now), notPastMeetingInvite(now)];
}

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
  const now = new Date();
  const live = liveMeetingPingClauses(now);
  const where: Prisma.NotificationWhereInput = {
    recipientUserId: userId,
    ...(opts.onlyUnread ? { readAt: null } : {}),
    AND: [
      NOT_CANCELLED_MEETING,
      // Staleness only hides rows still awaiting action. A read row stays in
      // the feed as history — the desktop app reads `readAt` off these rows to
      // retire the banners it already delivered.
      { OR: [{ readAt: { not: null } }, { AND: live }] },
    ],
  };

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: {
        recipientUserId: userId,
        readAt: null,
        AND: [NOT_CANCELLED_MEETING, ...live],
      },
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
