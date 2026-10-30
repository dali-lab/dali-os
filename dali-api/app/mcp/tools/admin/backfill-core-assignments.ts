import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

export const BACKFILL_CORE_ASSIGNMENTS_TOOL = {
  name: "backfill_core_assignments",
  description:
    "Write historical, untitled CoreAssignment rows, for backfill. A member who already has any " +
    "Core row in the term is skipped and counted. Backfilled rows do not count toward the public " +
    "team list. Sends no notification. Admins only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      assignments: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: {
          type: "object",
          properties: {
            userId: { type: "string" },
            termId: { type: "string" },
          },
          required: ["userId", "termId"],
          additionalProperties: false,
        },
      },
    },
    required: ["assignments"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Row = { userId: string; termId: string };
type Input = { assignments: Row[] };

export async function runBackfillCoreAssignments(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can backfill Core assignments.");
  }

  const keyOf = (row: Row) => `${row.userId}|${row.termId}`;
  const rows = [...new Map(args.assignments.map((row) => [keyOf(row), row])).values()];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const termIds = [...new Set(rows.map((r) => r.termId))];

  const [users, terms] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
    prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true } }),
  ]);
  const unknown = (wanted: string[], found: { id: string }[]) => {
    const have = new Set(found.map((f) => f.id));
    return wanted.filter((id) => !have.has(id));
  };
  const badUsers = unknown(userIds, users);
  const badTerms = unknown(termIds, terms);
  if (badUsers.length || badTerms.length) {
    throw new McpInvalidError(
      `Unknown userId(s): ${badUsers.join(", ") || "none"}. Unknown termId(s): ${badTerms.join(", ") || "none"}.`,
    );
  }

  const existing = await prisma.coreAssignment.findMany({
    where: { OR: rows },
    select: { userId: true, termId: true },
  });
  const held = new Set(existing.map(keyOf));
  const fresh = rows.filter((row) => !held.has(keyOf(row)));
  if (fresh.length) {
    await prisma.coreAssignment.createMany({
      data: fresh.map((row) => ({ ...row, leadTitle: null, backfilled: true })),
    });
  }
  const summary = { rows: rows.length, created: fresh.length, skipped: rows.length - fresh.length };

  await logAuditEvent({
    action: "core.assignment.backfill",
    userId: callerId,
    metadata: summary,
    request: ctx.request,
  });

  return { ok: true, ...summary };
}
