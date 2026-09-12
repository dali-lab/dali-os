// MCP tool: issue_term_agreements — mcp:admin (Core). Put the latest published
// version of each selected agreement in force for a term and send sign requests.
// Supports preview:true to inspect who would be notified before committing.
// Reuses previewTermIssue + issueTermAgreements from signing/lib/issue.server.ts.

import { isCore } from "~/lib/roles";
import { previewTermIssue, issueTermAgreements } from "~/signing/lib/issue.server";
import {
  McpForbiddenError,
  McpInvalidError,
  type McpTool,
  type McpCtx,
} from "../../registry";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const ISSUE_TERM_AGREEMENTS_TOOL = {
  name: "issue_term_agreements",
  description:
    "Core-only. Put the latest published version of each selected agreement in force for a term and send sign requests to the audience. Pass preview:true to see who would be notified without committing (the staffing board's confirm step). termId defaults to the current term; pass an upcoming term id to issue early. documentIds is required when preview is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      preview: {
        type: "boolean",
        description:
          "When true, return the issuable agreements + recipient lists without activating anything. Defaults to false.",
      },
      documentIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Agreement document ids to issue. Required when preview is false. Ignored when preview is true (all PerTerm App-gated agreements are shown).",
      },
      termId: {
        type: "string",
        description:
          "Target term id. Defaults to the current term. Accepts upcoming terms so agreements can be issued before a term starts.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  preview?: boolean;
  documentIds?: string[];
  termId?: string;
};

export async function runIssueTermAgreements(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const preview = args.preview ?? false;

  if (preview) {
    // Preview: return what previewTermIssue would notify without activating.
    const result = await previewTermIssue({ termId: args.termId });
    return { preview: true, ...result };
  }

  // Issue: documentIds is required.
  const documentIds = Array.isArray(args.documentIds)
    ? args.documentIds.filter((v): v is string => typeof v === "string")
    : [];
  if (documentIds.length === 0) {
    throw new McpInvalidError("documentIds is required and must be non-empty when preview is false.");
  }

  const result = await issueTermAgreements({
    documentIds,
    userId: ctx.user.id,
    termId: args.termId,
    request: ctx.request,
  });
  return { preview: false, ...result };
}

export const ISSUE_TERM_AGREEMENTS: McpTool = {
  def: ISSUE_TERM_AGREEMENTS_TOOL,
  run: (ctx: McpCtx, args) => runIssueTermAgreements(ctx, args as Args),
};
