// MCP `list_announcements` — pending and recently sent announcements.
// Requires mcp:admin (Core leads only).

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 20, maxLimit: 100 };
const PENDING_LIMIT = 20;

export const LIST_ANNOUNCEMENTS_TOOL = {
  name: "list_announcements",
  description:
    "List scheduled (pending) and sent announcements. `pending` holds the next 20 scheduled sends, soonest first, and `pendingTotal` is how many are scheduled in all. `recentlySent` is paged, newest first: pass page.nextCursor as cursor to read the next page until page.hasMore is false. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: { ...pageProps(PAGE_LIMITS) },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runListAnnouncements(ctx: McpCtx, args: PageArgs = {}) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can list announcements.");
  }

  const window = keysetWindow(args, PAGE_LIMITS, [
    { field: "sentAt", direction: "desc", type: "date" },
  ]);
  const [pending, pendingTotal, fetchedSent] = await Promise.all([
    prisma.scheduledAnnouncement.findMany({
      where: { canceledAt: null, sentAt: null },
      orderBy: { sendAt: "asc" },
      take: PENDING_LIMIT,
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
    prisma.scheduledAnnouncement.count({ where: { canceledAt: null, sentAt: null } }),
    prisma.scheduledAnnouncement.findMany({
      where: { AND: [{ sentAt: { not: null } }, window.where] },
      orderBy: window.orderBy,
      take: window.take,
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
  const { rows: recent, page } = keysetPage(fetchedSent, window);

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
    pendingTotal,
    page,
    recentlySent: recent.map(toRow),
  };
}
