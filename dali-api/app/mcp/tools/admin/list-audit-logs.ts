// MCP `list_audit_logs` — paginated audit log viewer for Core leads.
// Reuses the same filter/query helpers as the admin Audit Logs route.
// Requires the `mcp:admin` scope; caller must be isCore.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
} from "~/lib/audit-query";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_AUDIT_LOGS_TOOL = {
  name: "list_audit_logs",
  description:
    "Return paginated audit log entries. Filterable by action, actor userId, target id, person name/email, and date range. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", description: "Filter by audit action" },
      userId: { type: "string", description: "Filter by actor user ID" },
      targetId: { type: "string", description: "Filter by target ID" },
      person: {
        type: "string",
        description: "Search by name/email (searches both actor and target)",
      },
      from: { type: "string", description: "Start date (ISO)" },
      to: { type: "string", description: "End date (ISO)" },
      limit: {
        type: "number",
        description: "Max results (1–200, default 50)",
      },
      offset: { type: "number", description: "Pagination offset" },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action?: string;
  userId?: string;
  targetId?: string;
  person?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function runListAuditLogs(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view audit logs.");
  }

  const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(args.offset ?? 0) || 0, 0);

  // Reuse parseAuditFilters (which reads URLSearchParams) so filter logic is
  // never duplicated between the HTTP route and this tool.
  const params = new URLSearchParams();
  for (const key of ["action", "userId", "targetId", "person", "from", "to"] as const) {
    if (args[key] != null) params.set(key, String(args[key]));
  }
  const filters = parseAuditFilters(params);
  const where = {
    ...buildAuditWhere(filters),
    ...(await resolveAuditTextFilters(prisma, filters)),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { total, limit, offset, filters, entries };
}

