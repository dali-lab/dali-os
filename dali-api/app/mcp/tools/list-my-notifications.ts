// MCP `list_my_notifications` — returns the authenticated user's recent in-app
// notifications. Reuses the same fetch logic as the inbox endpoint at
// `api.notifications.ts`. Requires the `mcp:read` scope.

import { listMyNotifications } from "~/lib/notifications";

export const LIST_MY_NOTIFICATIONS_TOOL = {
  name: "list_my_notifications",
  description:
    "Return the authenticated DALI OS member's recent in-app notifications, with a total unread count.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum number of notifications to return (default 30, max 50).",
      },
      onlyUnread: {
        type: "boolean",
        description: "If true, only return notifications that have not been read.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { limit?: number; onlyUnread?: boolean };

export async function runListMyNotifications(
  userId: string,
  input: Input,
) {
  // Default to "20 unread + 10 read" semantics by fetching a slightly larger
  // mixed slice. When onlyUnread=true, callers usually want a shorter view.
  const limit = input.limit ?? (input.onlyUnread ? 20 : 30);
  const { items, unreadCount } = await listMyNotifications(userId, {
    limit,
    onlyUnread: input.onlyUnread ?? false,
  });
  return {
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
