// MCP `list_audit_logs` — paginated audit log viewer for Core leads.
// Reuses the same filter/query helpers as the admin Audit Logs route. Unlike
// the HTML viewer it returns MCP reads unless filtered out.
// Requires the `mcp:admin` scope; caller must be isCore.

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
} from "~/lib/audit-query";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_AUDIT_LOGS_TOOL = {
  name: "list_audit_logs",
  description:
    "Return audit log entries, newest first. Filterable by action, actor userId, target id, person name/email or IP, and date range. Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the count for the filters. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", description: "Filter by audit action" },
      area: {
        type: "string",
        description:
          "Filter by area (the action's first segment, e.g. staffing, mcp, auth, hiring, page). Ignored when action is set.",
      },
      userId: { type: "string", description: "Filter by actor user ID" },
      targetId: { type: "string", description: "Filter by target ID" },
      person: {
        type: "string",
        description: "Search by name/email (searches both actor and target), or by request IP: a full address matches exactly, a partial one like 129.170 matches the range",
      },
      from: { type: "string", description: "Start date (ISO)" },
      to: { type: "string", description: "End date (ISO)" },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = PageArgs & {
  action?: string;
  area?: string;
  userId?: string;
  targetId?: string;
  person?: string;
  from?: string;
  to?: string;
};

export async function runListAuditLogs(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view audit logs.");
  }

  const params = new URLSearchParams();
  for (const key of ["action", "area", "userId", "targetId", "person", "from", "to"] as const) {
    if (args[key] != null) params.set(key, String(args[key]));
  }
  const filters = parseAuditFilters(params);
  const where = {
    ...buildAuditWhere(filters),
    ...(await resolveAuditTextFilters(prisma, filters)),
  };

  const window = keysetWindow(args, PAGE_LIMITS, [
    { field: "createdAt", direction: "desc", type: "date" },
  ]);
  const [fetched, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { AND: [where, window.where] },
      orderBy: window.orderBy,
      take: window.take,
    }),
    prisma.auditLog.count({ where }),
  ]);
  const { rows: entries, page } = keysetPage(fetched, window, total);

  return { page, filters, entries };
}

