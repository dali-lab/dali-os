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

export async function readAnnouncementsActiveResource(callerId: string) {
  const rows = await prisma.notification.findMany({
    where: {
      recipientUserId: callerId,
      readAt: null,
      kind: "SystemAnnouncement",
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      body: true,
      link: true,
      dueAt: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });

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

  return sections.join("\n\n---\n\n");
}
