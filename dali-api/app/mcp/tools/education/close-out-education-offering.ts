// MCP tool: close_out_education_offering — issue completion certificates, grant
// instructor CE credits, and send close-out emails for an offering. Idempotent.
// Instructor or Core only (isOfferingManager). Scope: mcp:write — the web gate
// is isOfferingManager (an instructor who owns the offering can close it), so
// mcp:admin (Core/Admin-only at consent) would wrongly block a non-Core
// instructor. The runtime isOfferingManager check is the real gate; the
// outbound blast is fenced by idempotency + the preview action.

import { closeOutOffering, previewCloseOut } from "~/education/lib/certificates.server";
import { isOfferingManager } from "~/education/lib/access.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "../../registry";

export const CLOSE_OUT_EDUCATION_OFFERING_TOOL = {
  name: "close_out_education_offering",
  description:
    "Issue completion certificates, grant instructor CE credits, and send close-out emails for an offering. Idempotent — only issues missing certificates; already-issued ones are skipped. Instructor or Core only. Preview first with the preview action. Refuses to close out an offering that hasn't finished running unless allowEarly is set.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      preview: {
        type: "boolean",
        description:
          "If true, return a dry-run preview (eligible names, below-threshold names, already issued count) without issuing anything or sending emails.",
      },
      allowEarly: {
        type: "boolean",
        description:
          "Close out even if the offering's last session is still in the future. Off by default — closing early strands the offering in the past catalog before it happens, so only set this for a deliberate early close-out (e.g. a cancellation).",
      },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  offeringId: string;
  preview?: boolean;
  allowEarly?: boolean;
};

export async function runCloseOutEducationOffering(ctx: McpCtx, args: Input) {
  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  if (args.preview === true) {
    const result = await previewCloseOut(args.offeringId);
    if (result === null) throw new McpNotFoundError("Offering not found");
    return { preview: true, ...result };
  }

  const result = await closeOutOffering({
    offeringId: args.offeringId,
    actorId: ctx.user.id,
    allowEarly: args.allowEarly === true,
  });

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return {
    preview: false,
    issued: result.issued,
    alreadyIssued: result.alreadyIssued,
    ineligible: result.ineligible,
  };
}

export const CLOSE_OUT_EDUCATION_OFFERING: McpTool = {
  def: CLOSE_OUT_EDUCATION_OFFERING_TOOL,
  run: (ctx: McpCtx, args) => runCloseOutEducationOffering(ctx, args as Input),
};
