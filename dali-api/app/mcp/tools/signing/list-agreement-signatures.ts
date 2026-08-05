// MCP tool: list_agreement_signatures — Core-only view of all member signatures
// on a document's bindings. Useful for auditing who has signed.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { McpForbiddenError, type McpTool, type McpCtx } from "../../registry";

export const LIST_AGREEMENT_SIGNATURES_TOOL = {
  name: "list_agreement_signatures",
  description:
    "List all member signatures on a signing document. Core-only. Optionally filter by a specific binding. Returns signerId, name, signedAt, and binding context.",
  inputSchema: {
    type: "object" as const,
    properties: {
      documentId: {
        type: "string",
        description: "The signing document ID to list signatures for.",
      },
      bindingId: {
        type: "string",
        description: "Optional. Filter to a specific binding (context/term).",
      },
    },
    required: ["documentId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = {
  documentId: string;
  bindingId?: string;
};

export async function runListAgreementSignatures(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const sigs = await prisma.signingSignature.findMany({
    where: {
      roleKey: "member",
      binding: { documentId: args.documentId },
      ...(args.bindingId ? { bindingId: args.bindingId } : {}),
    },
    select: {
      id: true,
      typedName: true,
      signedAt: true,
      signerUserId: true,
      signer: { select: { firstName: true, lastName: true } },
      binding: { select: { id: true, scopeKey: true } },
    },
    orderBy: { signedAt: "desc" },
  });

  return {
    signatures: sigs.map((s) => ({
      signatureId: s.id,
      signerUserId: s.signerUserId,
      name: s.typedName || `${s.signer.firstName} ${s.signer.lastName}`.trim(),
      signedAt: s.signedAt.toISOString(),
      bindingId: s.binding.id,
      scopeKey: s.binding.scopeKey,
    })),
  };
}

export const LIST_AGREEMENT_SIGNATURES: McpTool = {
  def: LIST_AGREEMENT_SIGNATURES_TOOL,
  run: (ctx: McpCtx, args) => runListAgreementSignatures(ctx, args as Args),
};
