// MCP tool: list_agreement_signatures — Core-only view of all member signatures
// on a document's bindings. Useful for auditing who has signed.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { McpForbiddenError, type McpTool, type McpCtx } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_AGREEMENT_SIGNATURES_TOOL = {
  name: "list_agreement_signatures",
  description:
    "List member signatures on a signing document, newest first. Core-only. Optionally filter by a specific binding. Returns signerId, name, signedAt, and binding context. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
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
      ...pageProps(PAGE_LIMITS),
    },
    required: ["documentId"],
    additionalProperties: false,
  },
  // Core-only at runtime (isCore below). Tag as mcp:admin so the advertised
  // scope matches the gate — a non-Core mcp:read token would pass the scope
  // check then 403, which is misleading.
  requiredScope: "mcp:admin" as const,
};

type Args = PageArgs & {
  documentId: string;
  bindingId?: string;
};

export async function runListAgreementSignatures(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const baseWhere = {
    roleKey: "member",
    binding: { documentId: args.documentId },
    ...(args.bindingId ? { bindingId: args.bindingId } : {}),
  };
  const window = keysetWindow(args, PAGE_LIMITS, [{ field: "signedAt", direction: "desc", type: "date" }]);
  const [fetched, total] = await Promise.all([
    prisma.signingSignature.findMany({
      where: { AND: [baseWhere, window.where] },
      select: {
        id: true,
        typedName: true,
        signedAt: true,
        signerUserId: true,
        signer: { select: { firstName: true, lastName: true } },
        binding: { select: { id: true, scopeKey: true } },
      },
      orderBy: window.orderBy,
      take: window.take,
    }),
    prisma.signingSignature.count({ where: baseWhere }),
  ]);
  const { rows: sigs, page } = keysetPage(fetched, window, total);

  return {
    page,
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
