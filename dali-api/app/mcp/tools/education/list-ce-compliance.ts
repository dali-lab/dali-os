// MCP tool: list_ce_compliance — per-member CE credit compliance for a term.
// Reuses complianceForTerm from ce-credits.server.ts.
// Gate: Core only (mcp:admin).
// Scope: mcp:admin.

import { complianceForTerm } from "~/education/lib/ce-credits.server";
import { isCore } from "~/lib/roles";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";
import { prisma } from "~/lib/db";
import { pageArray, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_CE_COMPLIANCE_TOOL = {
  name: "list_ce_compliance",
  description:
    "List per-member CE credit compliance for a term. Returns every current lab member with their credit count and whether they meet the ≥1 credit minimum. Full-time staff are excluded (they are exempt). Core only. Pass page.nextCursor as cursor to read the next page of members until page.hasMore is false. compliantCount and nonCompliantCount cover the whole roster, not just the page.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: { type: "string", minLength: 1 },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["termId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = PageArgs & { termId: string };

export async function runListCeCompliance(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  // Verify the term exists.
  const term = await prisma.term.findUnique({
    where: { id: args.termId },
    select: { id: true, code: true },
  });
  if (!term) throw new McpNotFoundError("Term not found");

  const rows = await complianceForTerm(args.termId);

  const { rows: members, page } = pageArray(rows, args, PAGE_LIMITS);

  return {
    termId: args.termId,
    termCode: term.code,
    page,
    members,
    compliantCount: rows.filter((r) => r.compliant).length,
    nonCompliantCount: rows.filter((r) => !r.compliant).length,
  };
}

export const LIST_CE_COMPLIANCE: McpTool = {
  def: LIST_CE_COMPLIANCE_TOOL,
  run: (ctx: McpCtx, args) => runListCeCompliance(ctx, args as Args),
};
