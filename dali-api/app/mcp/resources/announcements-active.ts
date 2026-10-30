// MCP resource `dali://announcements/active` — the caller's unread
// SystemAnnouncement notifications, rendered as markdown so clients (e.g.
// Claude Desktop) display them inline. "Active" = unread + the underlying
// scheduled-meeting (if any) is not Cancelled, mirroring the inbox filter in
// `listMyNotifications`. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";

export const ANNOUNCEMENTS_ACTIVE_RESOURCE = {
  uri: "dali://announcements/active",
  name: "Active announcements",
  description:
    "Lab announcements the authenticated member has not yet read, newest first. Markdown.",
  mimeType: "text/markdown",
  requiredScope: "mcp:read" as const,
};

const ACTIVE_LIMIT = 50;

export async function readAnnouncementsActiveResource(callerId: string) {
  const where = {
    recipientUserId: callerId,
    readAt: null,
    kind: "SystemAnnouncement" as const,
  };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ACTIVE_LIMIT,
    select: {
      id: true,
      title: true,
      body: true,
      link: true,
      dueAt: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
    }),
    prisma.notification.count({ where }),
  ]);

  if (rows.length === 0) {
    return "_No active announcements._";
  }

  const sections = rows.map((row) => {
    const author = row.createdBy
      ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim()
      : null;
    const meta = [
      `Posted ${row.createdAt.toISOString()}`,
      author ? `by ${author}` : null,
      row.dueAt ? `Due ${row.dueAt.toISOString()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return [
      `## ${row.title}`,
      `_${meta}_`,
      row.body ?? "",
      row.link ? `[Open](${row.link})` : "",
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
  });

  const body = sections.join("\n\n---\n\n");
  return total > rows.length ? `_Showing ${rows.length} of ${total} active announcements, newest first._\n\n${body}` : body;
}
