// MCP tool: decide_education_application — approve, reject, or waitlist a
// student's application. Instructor or Core only. Supports bulk-approve to
// fill available seats from the Submitted queue in FIFO order. Scope: mcp:write.

import { decideApplication, approveAllPending } from "~/education/lib/decisions.server";
import { isOfferingManager } from "~/education/lib/access.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "../../registry";

const DECIDABLE_STATUSES = ["Approved", "Rejected", "Waitlisted", "Withdrawn"] as const;
type DecidableStatus = (typeof DECIDABLE_STATUSES)[number];

export const DECIDE_EDUCATION_APPLICATION_TOOL = {
  name: "decide_education_application",
  description:
    "Approve, reject, or waitlist a student's application. Instructor or Core only. Use bulk_approve:true to approve all Submitted applications in FIFO order until capacity is reached (ignore applicationId in that case).",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      applicationId: {
        type: "string",
        description: "Required unless bulk_approve is true.",
      },
      status: {
        type: "string",
        enum: DECIDABLE_STATUSES as unknown as string[],
        description: "Required unless bulk_approve is true.",
      },
      bulk_approve: {
        type: "boolean",
        description:
          "If true, approve all Submitted applications in FIFO order until capacity.",
      },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  offeringId: string;
  applicationId?: string;
  status?: DecidableStatus;
  bulk_approve?: boolean;
};

export async function runDecideEducationApplication(ctx: McpCtx, args: Input) {
  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  if (args.bulk_approve === true) {
    const result = await approveAllPending({
      offeringId: args.offeringId,
      actorId: ctx.user.id,
    });
    return { ok: true, approved: result.approved, skipped: result.skipped };
  }

  if (!args.applicationId || !args.status) {
    throw new McpInvalidError(
      "applicationId and status are required unless bulk_approve is true",
    );
  }

  const result = await decideApplication({
    applicationId: args.applicationId,
    offeringId: args.offeringId,
    status: args.status as DecidableStatus,
    actorId: ctx.user.id,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return {
    ok: true,
    status: result.status,
    promotedFromWaitlist: result.promotedApplicationId !== null,
  };
}

export const DECIDE_EDUCATION_APPLICATION: McpTool = {
  def: DECIDE_EDUCATION_APPLICATION_TOOL,
  run: (ctx: McpCtx, args) =>
    runDecideEducationApplication(ctx, args as Input),
};
