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
import { listNotificationHistory, type NotificationHistoryOptions } from "~/lib/tasks";

export const LIST_MY_NOTIFICATIONS_TOOL = {
  name: "list_my_notifications",
  description:
    "Return the authenticated DALI OS member's in-app notifications. " +
    "By default returns the live inbox (newest 30, with staleness hides). " +
    "Pass any of status/kind/q/cursor to switch to history mode: paginated full " +
    "history with open/cleared counts and a `state` annotation on each item.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum number of notifications to return (inbox default 30, history default 30; max 50).",
      },
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
      cursor: {
        type: "string",
        description: "History mode: opaque pagination cursor returned as `nextCursor` from a previous call.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  limit?: number;
  onlyUnread?: boolean;
  // history-mode params
  status?: "open" | "cleared" | "all";
  kind?: string;
  q?: string;
  cursor?: string;
};

const HISTORY_TRIGGER_PARAMS = ["status", "kind", "q", "cursor"] as const;

export async function runListMyNotifications(
  userId: string,
  input: Input,
) {
  const isHistory = HISTORY_TRIGGER_PARAMS.some((p) => input[p] !== undefined);

  if (isHistory) {
    // Parse the cursor string (JSON {createdAt, id}) if provided.
    let cursor: NotificationHistoryOptions["cursor"] = null;
    if (input.cursor) {
      try {
        const parsed = JSON.parse(input.cursor) as { createdAt?: unknown; id?: unknown };
        if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        }
      } catch {
        // Malformed cursor — treat as first page.
      }
    }

    const result = await listNotificationHistory(userId, {
      status: input.status,
      kind: input.kind,
      q: input.q,
      cursor,
      limit: input.limit,
    });

    return {
      mode: "history" as const,
      items: result.items,
      nextCursor: result.nextCursor ? JSON.stringify(result.nextCursor) : null,
      counts: result.counts,
    };
  }

  // ── Inbox mode ────────────────────────────────────────────────────────────
  const opts: ListNotificationsOptions = {
    limit: input.limit ?? (input.onlyUnread ? 20 : 30),
    onlyUnread: input.onlyUnread ?? false,
  };
  const { items, unreadCount } = await listMyNotifications(userId, opts);

  return {
    mode: "inbox" as const,
    unreadCount,
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
