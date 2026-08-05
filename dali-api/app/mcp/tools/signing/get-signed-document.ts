// MCP tool: get_signed_document — retrieves a member's own signed copy of a
// binding, including the frozen body snapshot captured at signing time.

import { prisma } from "~/lib/db";
import { McpNotFoundError, type McpTool, type McpCtx } from "../../registry";

export const GET_SIGNED_DOCUMENT_TOOL = {
  name: "get_signed_document",
  description:
    "Retrieve the caller's own signed copy of an agreement binding. Returns the document metadata, version number, typed name, and a flag indicating if the archived body is legacy ProseMirror format.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bindingId: {
        type: "string",
        description: "The binding ID to look up the caller's signature for.",
      },
    },
    required: ["bindingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = {
  bindingId: string;
};

function isLegacyBody(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    "type" in (body as object) &&
    (body as { type: unknown }).type === "doc"
  );
}

export async function runGetSignedDocument(ctx: McpCtx, args: Args) {
  const sig = await prisma.signingSignature.findUnique({
    where: {
      bindingId_signerUserId_roleKey: {
        bindingId: args.bindingId,
        signerUserId: ctx.user.id,
        roleKey: "member",
      },
    },
    select: {
      id: true,
      signedAt: true,
      typedName: true,
      frozenBody: true,
      bindingId: true,
      binding: {
        select: {
          document: { select: { name: true, kind: true } },
          version: { select: { versionNumber: true, body: true } },
        },
      },
    },
  });

  if (!sig) throw new McpNotFoundError("No signature found for this binding.");

  const archiveBody = sig.frozenBody ?? sig.binding.version.body;

  return {
    signatureId: sig.id,
    bindingId: sig.bindingId,
    documentName: sig.binding.document.name,
    documentKind: sig.binding.document.kind,
    versionNumber: sig.binding.version.versionNumber,
    signedAt: sig.signedAt.toISOString(),
    typedName: sig.typedName,
    frozenBodyIsLegacy: isLegacyBody(archiveBody),
  };
}

export const GET_SIGNED_DOCUMENT: McpTool = {
  def: GET_SIGNED_DOCUMENT_TOOL,
  run: (ctx: McpCtx, args) => runGetSignedDocument(ctx, args as Args),
};
