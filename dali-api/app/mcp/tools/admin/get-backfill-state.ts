import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";
import type { McpCtx } from "../../registry";

export const GET_BACKFILL_STATE_TOOL = {
  name: "get_backfill_state",
  description:
    "Read what a backfill needs to reconcile against: the users holding the given NetIDs, and the " +
    "project and Core assignments in the given terms. Read-only. Admins only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      netIds: {
        type: "array",
        items: { type: "string" },
        maxItems: 200,
        description: "NetIDs to resolve. Unknown ones are simply absent from `members`.",
      },
      termIds: {
        type: "array",
        items: { type: "string" },
        maxItems: 60,
        description: "Terms to read assignments for.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = { netIds?: string[]; termIds?: string[] };

export async function runGetBackfillState(ctx: McpCtx, args: Input) {
  if (!(await isAdmin(ctx.user.id))) {
    throw new McpForbiddenError("Only admins can read backfill state.");
  }

  const netIds = (args.netIds ?? []).map((id) => id.trim()).filter(Boolean);
  const termIds = args.termIds ?? [];

  const [members, projectAssignments, coreAssignments] = await Promise.all([
    netIds.length
      ? prisma.user.findMany({
          where: {
            netId: {
              in: [...netIds.map((id) => id.toLowerCase()), ...netIds.map((id) => id.toUpperCase())],
            },
          },
          select: { id: true, netId: true, firstName: true, lastName: true },
        })
      : [],
    termIds.length
      ? prisma.projectAssignment.findMany({
          where: { termId: { in: termIds } },
          select: {
            id: true,
            userId: true,
            projectId: true,
            termId: true,
            domainId: true,
            level: true,
          },
        })
      : [],
    termIds.length
      ? prisma.coreAssignment.findMany({
          where: { termId: { in: termIds } },
          select: { userId: true, termId: true, leadTitle: true, backfilled: true },
        })
      : [],
  ]);

  return { members, projectAssignments, coreAssignments };
}
