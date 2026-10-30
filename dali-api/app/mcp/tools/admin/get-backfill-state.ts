import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError, AdminInvalidError as McpInvalidError } from "./errors";
import type { McpCtx } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const GET_BACKFILL_STATE_TOOL = {
  name: "get_backfill_state",
  description:
    "Read what a backfill needs to reconcile against: the users holding the given NetIDs, and the " +
    "project and Core assignments in the given terms. Read-only. Admins only. " +
    "Assignments are paged one kind at a time: `assignments` picks project (default) or core, and " +
    "that kind comes back in its own key with the other key null. Pass page.nextCursor as cursor, with " +
    "the same `assignments` and `termIds`, until page.hasMore is false, then repeat with the other kind. " +
    "`members` is returned on the first page only.",
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
      assignments: {
        type: "string",
        enum: ["project", "core"],
        description: "Which assignments to page: project (default) or core.",
      },
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = PageArgs & { netIds?: string[]; termIds?: string[]; assignments?: "project" | "core" };

export async function runGetBackfillState(ctx: McpCtx, args: Input) {
  if (!(await isAdmin(ctx.user.id))) {
    throw new McpForbiddenError("Only admins can read backfill state.");
  }

  const netIds = (args.netIds ?? []).map((id) => id.trim()).filter(Boolean);
  const termIds = args.termIds ?? [];
  const kind = args.assignments === "core" ? "core" : "project";
  if (args.assignments !== undefined && args.assignments !== "project" && args.assignments !== "core") {
    throw new McpInvalidError("assignments must be project or core.");
  }

  const window = keysetWindow(args, PAGE_LIMITS, [], "asc");
  const where = { termId: { in: termIds } };
  const firstPage = !args.cursor;

  const [members, projectRows, coreRows, total] = await Promise.all([
    netIds.length && firstPage
      ? prisma.user.findMany({
          where: {
            netId: {
              in: [...netIds.map((id) => id.toLowerCase()), ...netIds.map((id) => id.toUpperCase())],
            },
          },
          select: { id: true, netId: true, firstName: true, lastName: true },
        })
      : [],
    termIds.length && kind === "project"
      ? prisma.projectAssignment.findMany({
          where: { AND: [where, window.where] },
          orderBy: window.orderBy,
          take: window.take,
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
    termIds.length && kind === "core"
      ? prisma.coreAssignment.findMany({
          where: { AND: [where, window.where] },
          orderBy: window.orderBy,
          take: window.take,
          select: { id: true, userId: true, termId: true, leadTitle: true, backfilled: true },
        })
      : [],
    termIds.length
      ? kind === "project"
        ? prisma.projectAssignment.count({ where })
        : prisma.coreAssignment.count({ where })
      : 0,
  ]);

  const { rows, page } = keysetPage<object>(kind === "project" ? projectRows : coreRows, window, total);

  return {
    members,
    projectAssignments: kind === "project" ? rows : null,
    coreAssignments: kind === "core" ? rows : null,
    page,
  };
}
