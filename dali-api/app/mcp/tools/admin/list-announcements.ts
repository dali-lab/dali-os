// MCP `list_announcements` — pending and recently sent announcements.
// Requires mcp:admin (Core leads only).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_ANNOUNCEMENTS_TOOL = {
  name: "list_announcements",
  description:
    "List scheduled (pending) and recently sent announcements. Returns up to 20 pending + 20 recently sent rows. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListAnnouncements(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can list announcements.");
  }

  const [pending, recent] = await Promise.all([
    prisma.scheduledAnnouncement.findMany({
      where: { canceledAt: null, sentAt: null },
      orderBy: { sendAt: "asc" },
      take: 20,
      select: {
        id: true,
        title: true,
        sendAt: true,
        sentAt: true,
        allMembers: true,
        groupIds: true,
        userIds: true,
        lastError: true,
      },
    }),
    prisma.scheduledAnnouncement.findMany({
      where: { sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        sendAt: true,
        sentAt: true,
        allMembers: true,
        groupIds: true,
        userIds: true,
        lastError: true,
      },
    }),
  ]);

  const toRow = (s: typeof pending[number]) => ({
    id: s.id,
    title: s.title,
    sendAt: s.sendAt.toISOString(),
    sentAt: s.sentAt?.toISOString() ?? null,
    allMembers: s.allMembers,
    groupCount: s.groupIds.length,
    userCount: s.userIds.length,
    lastError: s.lastError,
  });

  return {
    pending: pending.map(toRow),
    recentlySent: recent.map(toRow),
  };
}
