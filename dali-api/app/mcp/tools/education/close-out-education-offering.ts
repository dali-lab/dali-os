// MCP tool: close_out_education_offering — issue completion certificates, grant
// instructor CE credits, and send close-out emails for an offering. Idempotent.
// Instructor or Core only. Scope: mcp:admin.

import { closeOutOffering, previewCloseOut } from "~/education/lib/certificates.server";
import { isOfferingManager } from "~/education/lib/access.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpForbiddenError, McpNotFoundError, McpInvalidError } from "../../registry";

export const CLOSE_OUT_EDUCATION_OFFERING_TOOL = {
  name: "close_out_education_offering",
  description:
    "Issue completion certificates, grant instructor CE credits, and send close-out emails for an offering. Idempotent — only issues missing certificates; already-issued ones are skipped. Instructor or Core only. Preview first with the preview action.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offeringId: { type: "string", minLength: 1 },
      preview: {
        type: "boolean",
        description:
          "If true, return a dry-run preview (eligible names, below-threshold names, already issued count) without issuing anything or sending emails.",
      },
    },
    required: ["offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Input = {
  offeringId: string;
  preview?: boolean;
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
