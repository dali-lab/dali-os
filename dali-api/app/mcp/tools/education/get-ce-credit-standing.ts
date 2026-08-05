// MCP tool: get_ce_credit_standing — the caller's CE credit standing for the
// current term, plus their full credit history. Returns null standing when
// there's no active term or the caller is exempt (full-time staff).
// Scope: mcp:read.

import { myCreditStanding, creditHistory } from "~/education/lib/ce-credits.server";
import type { McpCtx, McpTool } from "../../registry";

export const GET_CE_CREDIT_STANDING_TOOL = {
  name: "get_ce_credit_standing",
  description:
    "Get your CE (continuing education) credit standing for the current term, plus your full credit history.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetCeCreditStanding(ctx: McpCtx) {
  const [standing, history] = await Promise.all([
    myCreditStanding(ctx.user.id),
    creditHistory(ctx.user.id),
  ]);
  return {
    standing,
    history: history.map((c) => ({
      ...c,
      grantedAt: c.grantedAt instanceof Date ? c.grantedAt.toISOString() : c.grantedAt,
    })),
  };
}

export const GET_CE_CREDIT_STANDING: McpTool = {
  def: GET_CE_CREDIT_STANDING_TOOL,
  run: (ctx: McpCtx, _args) => runGetCeCreditStanding(ctx),
};
