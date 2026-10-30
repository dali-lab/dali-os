// MCP `list_my_notifications` — returns the authenticated user's in-app
// notifications. Two modes, mirroring `api.notifications.ts` GET:
//
//   Inbox mode (default): the live feed — staleness hides apply (expired
//     meeting reminders, past meeting invites), cancelled-meeting notifications
//     are excluded. Same view as the web bell / desktop app feed.
//
//   History mode (any of status/kind/q/cursor present): full browsable
//     history with keyset pagination and open/cleared counts. No liveness
//     hides; every item has a `state` annotation.
//
// Requires the `mcp:read` scope.

import { listMyNotifications, type ListNotificationsOptions } from "~/lib/notifications";
import { listNotificationHistory } from "~/lib/tasks";
import { keysetPage, keysetWindow, pageProps, type PageArgs, type PageInfo } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 30, maxLimit: 50 };

export const LIST_MY_NOTIFICATIONS_TOOL = {
  name: "list_my_notifications",
  description:
    "Return the authenticated DALI OS member's in-app notifications. " +
    "By default returns the live inbox (newest 30, with staleness hides). The inbox has no cursor: " +
    "page.hasMore says older items exist, and history mode reaches them. " +
    "Pass any of status/kind/q/cursor to switch to history mode: full history, newest first, " +
    "with open/cleared counts and a `state` annotation on each item. " +
    "In history mode pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ...pageProps(PAGE_LIMITS),
      onlyUnread: {
        type: "boolean",
        description: "Inbox mode only: if true, only return notifications that have not been read.",
      },
      status: {
        type: "string",
        enum: ["open", "cleared", "all"],
        description: "History mode: filter by open (unread) or cleared (read). Default \"all\".",
      },
      kind: {
        type: "string",
        description: "History mode: filter by NotificationKind (e.g. \"MeetingInvite\", \"SystemAnnouncement\").",
      },
      q: {
        type: "string",
        description: "History mode: case-insensitive substring match against title and body.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & {
  onlyUnread?: boolean;
  // history-mode params
  status?: "open" | "cleared" | "all";
  kind?: string;
  q?: string;
};

const HISTORY_TRIGGER_PARAMS = ["status", "kind", "q", "cursor"] as const;

export async function runListMyNotifications(
  userId: string,
  input: Input,
) {
  const isHistory = HISTORY_TRIGGER_PARAMS.some((p) => input[p] !== undefined);

  if (isHistory) {
    const window = keysetWindow(input, PAGE_LIMITS, [
      { field: "createdAt", direction: "desc", type: "date" },
    ]);
    // listNotificationHistory keeps its {createdAt, id} cursor for the web
    // routes, so the shared cursor is decoded from the keyset predicate.
    const [, tie] = (window.where.OR ?? []) as { createdAt: Date; id: { lt: string } }[];
    const result = await listNotificationHistory(userId, {
      status: input.status,
      kind: input.kind,
      q: input.q,
      cursor: tie ? { createdAt: tie.createdAt.toISOString(), id: tie.id.lt } : null,
      limit: window.limit,
    });
    const { page } = keysetPage(
      [
        ...result.items.map((i) => ({ createdAt: i.sentAt, id: i.id })),
        ...(result.nextCursor ? [result.nextCursor] : []),
      ],
      window,
    );

    return {
      mode: "history" as const,
      items: result.items,
      page,
      counts: result.counts,
    };
  }

  // ── Inbox mode ────────────────────────────────────────────────────────────
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? (input.onlyUnread ? 20 : PAGE_LIMITS.defaultLimit)) || 1, 1),
    PAGE_LIMITS.maxLimit,
  );
  const opts: ListNotificationsOptions = {
    limit: limit + 1,
    maxLimit: PAGE_LIMITS.maxLimit + 1,
    onlyUnread: input.onlyUnread ?? false,
  };
  const { items: fetched, unreadCount } = await listMyNotifications(userId, opts);
  const hasMore = fetched.length > limit;
  const items = hasMore ? fetched.slice(0, limit) : fetched;
  const page: PageInfo = { nextCursor: null, hasMore, limit };

  return {
    mode: "inbox" as const,
    unreadCount,
    page,
    notifications: items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
      scheduledMeetingId: n.scheduledMeetingId,
      rsvp: n.rsvp,
    })),
  };
}
