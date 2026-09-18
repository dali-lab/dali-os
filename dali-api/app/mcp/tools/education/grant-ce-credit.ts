// MCP tool: grant_ce_credit — manually grant a CE credit to a member for a term.
// Reuses grantManualCredit from ce-credits.server.ts.
// Gate: Core only (mcp:admin).
// Scope: mcp:admin.

import { grantManualCredit } from "~/education/lib/ce-credits.server";
import { isCore } from "~/lib/roles";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GRANT_CE_CREDIT_TOOL = {
  name: "grant_ce_credit",
  description:
    "Manually grant a CE credit to a lab member for a specific term. Use for the async CEC check-in path or special cases. Attendance-derived credits are managed automatically through attendance marking. Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userId: { type: "string", minLength: 1 },
      termId: { type: "string", minLength: 1 },
      reason: {
        type: "string",
        minLength: 1,
        description: "Reason for the manual grant (required).",
      },
    },
    required: ["userId", "termId", "reason"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { userId: string; termId: string; reason: string };

export async function runGrantCeCredit(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const result = await grantManualCredit({
    userId: args.userId,
    termId: args.termId,
    reason: args.reason,
    actorId: ctx.user.id,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true };
}

export const GRANT_CE_CREDIT: McpTool = {
  def: GRANT_CE_CREDIT_TOOL,
  run: (ctx: McpCtx, args) => runGrantCeCredit(ctx, args as Args),
};
