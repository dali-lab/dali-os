// MCP `list_ai_usage` — AI doc-writing usage summary per member.
// Reuses admin.ai-usage.tsx loader logic. mcp:admin, Core leads only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const LIST_AI_USAGE_TOOL = {
  name: "list_ai_usage",
  description:
    "AI doc-writing usage summary per member over the last 7, 30, or 90 days. " +
    "Returns per-user request counts and token totals plus lab-wide totals. Core leads only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      rangeDays: {
        type: "number",
        enum: [7, 30, 90],
        description: "Look-back window in days (default: 30).",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { rangeDays?: number };

function sinceDay(days: number): string {
  return new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function runListAiUsage(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Only Core leads can view AI usage.");
  }

  const days = [7, 30, 90].includes(args.rangeDays ?? 30) ? (args.rangeDays ?? 30) : 30;
  const since = sinceDay(days);

  const perUser = await prisma.aiUsage.groupBy({
    by: ["userId"],
    where: { day: { gte: since } },
    _sum: { count: true, inputTokens: true, outputTokens: true },
    _max: { day: true },
    orderBy: { _sum: { count: "desc" } },
  });

  const userIds = perUser.map((r) => r.userId);
  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, daliEmail: true },
        });
  const userById = new Map(users.map((u) => [u.id, u]));

  const totals = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const rows = perUser.map((r) => {
    const u = userById.get(r.userId);
    const requests = r._sum.count ?? 0;
    const inputTokens = r._sum.inputTokens ?? 0;
    const outputTokens = r._sum.outputTokens ?? 0;
    totals.requests += requests;
    totals.inputTokens += inputTokens;
    totals.outputTokens += outputTokens;
    return {
      userId: r.userId,
      name: u
        ? ((u.firstName ?? "") + " " + (u.lastName ?? "")).trim() || u.daliEmail
        : r.userId,
      email: u?.daliEmail ?? null,
      requests,
      inputTokens,
      outputTokens,
      lastUsed: r._max.day ?? null,
    };
  });

  return { rangeDays: days, since, totals, rows };
}
