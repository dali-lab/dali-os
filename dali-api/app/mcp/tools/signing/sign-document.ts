// MCP tool: sign_document — record the caller's member signature on a binding.
// Delegates to recordSignature for field validation, body freezing, and audit
// logging; applies the same audience gate as the app-enforcement layer.

import { recordSignature } from "~/signing/lib/sign.server";
import { getSignerCohorts } from "~/signing/lib/state.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { prisma } from "~/lib/db";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  type McpTool,
  type McpCtx,
} from "../../registry";

export const SIGN_DOCUMENT_TOOL = {
  name: "sign_document",
  description:
    "Sign a lab agreement binding as the current user. Validates audience eligibility and required fields before recording the signature.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bindingId: {
        type: "string",
        description: "The binding ID to sign.",
      },
      fieldValues: {
        type: "object",
        description:
          "Key-value map of field IDs to values (signature text, checkbox booleans, etc.). Required fields for the member role must be filled.",
        additionalProperties: true,
      },
    },
    required: ["bindingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  bindingId: string;
  fieldValues?: Record<string, unknown>;
};

export async function runSignDocument(ctx: McpCtx, args: Args) {
  // Load the binding to check audience.
  const binding = await prisma.signingBinding.findUnique({
    where: { id: args.bindingId },
    select: { document: { select: { audience: true } } },
  });
  if (!binding) throw new McpNotFoundError("Binding not found.");

  // Audience gate: same check as listOutstandingBindings.
  const cohorts = await getSignerCohorts(ctx.user.id);
  const resolver = AUDIENCE_RESOLVERS[binding.document.audience];
  if (!resolver.includes(cohorts)) {
    throw new McpForbiddenError(
      "You are not in the audience for this agreement.",
    );
  }

  const result = await recordSignature({
    bindingId: args.bindingId,
    signerUserId: ctx.user.id,
    fieldValues: args.fieldValues ?? {},
    request: ctx.request,
  });

  if (!result.ok) throw new McpInvalidError(result.error);

  return { ok: true, bindingId: args.bindingId };
}

export const SIGN_DOCUMENT: McpTool = {
  def: SIGN_DOCUMENT_TOOL,
  run: (ctx: McpCtx, args) => runSignDocument(ctx, args as Args),
};
