// MCP tool: remind_ce_noncompliant — nudge every member who still owes a CE
// credit this term via in-app notification (+ email per preference).
// Reuses remindNonCompliant from ce-credits.server.ts.
// Gate: Core only (mcp:admin).
// Scope: mcp:admin.

import { remindNonCompliant } from "~/education/lib/ce-credits.server";
import { isCore } from "~/lib/roles";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { prisma } from "~/lib/db";

export const REMIND_CE_NONCOMPLIANT_TOOL = {
  name: "remind_ce_noncompliant",
  description:
    "Send an in-app (and email per preference) reminder to every lab member who hasn't yet earned a CE credit for the specified term. Returns the number of members reminded. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: { type: "string", minLength: 1 },
    },
    required: ["termId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { termId: string };

export async function runRemindCeNoncompliant(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  // Verify the term exists before running the fan-out.
  const term = await prisma.term.findUnique({
    where: { id: args.termId },
    select: { id: true },
  });
  if (!term) throw new McpNotFoundError("Term not found");

  let result: { reminded: number };
  try {
    result = await remindNonCompliant({ termId: args.termId, actorId: ctx.user.id });
  } catch (err) {
    throw new McpInvalidError(
      err instanceof Error ? err.message : "Failed to send reminders",
    );
  }

  return { ok: true, reminded: result.reminded };
}

export const REMIND_CE_NONCOMPLIANT: McpTool = {
  def: REMIND_CE_NONCOMPLIANT_TOOL,
  run: (ctx: McpCtx, args) => runRemindCeNoncompliant(ctx, args as Args),
};
