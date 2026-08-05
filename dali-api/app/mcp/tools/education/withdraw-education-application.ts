// MCP tool: withdraw_education_application — withdraw your own application.
// Works for any non-closed status (Submitted, Approved, Waitlisted). Frees an
// Approved seat and auto-promotes the next waitlisted applicant. Scope: mcp:write.

import { withdrawApplication } from "~/education/lib/decisions.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpNotFoundError, McpInvalidError } from "../../registry";

export const WITHDRAW_EDUCATION_APPLICATION_TOOL = {
  name: "withdraw_education_application",
  description:
    "Withdraw your own application from an education offering. Works for any non-closed status (Submitted, Approved, Waitlisted). Frees an Approved seat and auto-promotes the next waitlisted applicant.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { offeringId: string };

export async function runWithdrawEducationApplication(ctx: McpCtx, args: Input) {
  const result = await withdrawApplication({
    userId: ctx.user.id,
    offeringId: args.offeringId,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, promotedFromWaitlist: result.promotedApplicationId !== null };
}

export const WITHDRAW_EDUCATION_APPLICATION: McpTool = {
  def: WITHDRAW_EDUCATION_APPLICATION_TOOL,
  run: (ctx: McpCtx, args) =>
    runWithdrawEducationApplication(ctx, args as Input),
};
