// MCP tool: get_signed_document_admin — mcp:admin (Core). Read another member's
// full signed copy: the frozen archival body (field values baked in), plus
// signing metadata (IP, user-agent, typed name, version). Mirrors the
// core.agreements.$id.signature.$sigId.tsx loader. The existing get_signed_document
// is member-self only; this extends access to Core reviewers.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";

// Inline helper — same logic as looksLikeProseMirrorDoc in components/doc but
// avoids pulling the React component barrel into this server-only MCP tool.
function isLegacyBody(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in (value as object) &&
    (value as { type: unknown }).type === "doc"
  );
}
import {
  McpNotFoundError,
  McpForbiddenError,
  type McpTool,
  type McpCtx,
} from "../../registry";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const GET_SIGNED_DOCUMENT_ADMIN_TOOL = {
  name: "get_signed_document_admin",
  description:
    "Core-only. Read another member's full signed copy of an agreement: frozen archival body (with field values baked in), signing metadata (IP, user agent, typed name, role, version number), and whether the body was pre-migration legacy ProseMirror JSON. The existing get_signed_document only returns the caller's own copy; this tool is for Core reviewers auditing compliance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      signatureId: {
        type: "string",
        description:
          "The signature id (from list_agreement_signatures or list_agreements activity feed).",
      },
    },
    required: ["signatureId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { signatureId: string };

export async function runGetSignedDocumentAdmin(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const sig = await prisma.signingSignature.findUnique({
    where: { id: args.signatureId },
    select: {
      id: true,
      roleKey: true,
      typedName: true,
      ip: true,
      userAgent: true,
      signedAt: true,
      frozenBody: true,
      signerUserId: true,
      signer: { select: { firstName: true, lastName: true } },
      binding: { select: { documentId: true } },
      version: {
        select: {
          versionNumber: true,
          body: true,
          document: { select: { name: true } },
        },
      },
    },
  });
  if (!sig) throw new McpNotFoundError("Signature not found.");

  // Exact same body-format logic as the web route loader: frozenBody if present,
  // otherwise fall back to version body. Never transcode — just flag the format.
  const rawBody = sig.frozenBody ?? sig.version.body;
  const isLegacy = isLegacyBody(rawBody);
  // Always return block JSON (convert legacy on read; the DB row is never touched).
  const body = ensureBlocks(rawBody);

  return {
    signatureId: sig.id,
    signerUserId: sig.signerUserId,
    signerName: fullName(sig.signer) || sig.typedName || "Unknown",
    roleKey: sig.roleKey,
    documentId: sig.binding.documentId,
    documentName: sig.version.document.name,
    versionNumber: sig.version.versionNumber,
    signedAt: sig.signedAt.toISOString(),
    typedName: sig.typedName,
    ip: sig.ip ?? null,
    userAgent: sig.userAgent ?? null,
    // Block-JSON frozen body (field values + variables baked in at sign time).
    body,
    // True when the original archived copy was legacy ProseMirror JSON; the
    // returned body has always been converted to block JSON.
    frozenBodyIsLegacy: isLegacy,
  };
}

export const GET_SIGNED_DOCUMENT_ADMIN: McpTool = {
  def: GET_SIGNED_DOCUMENT_ADMIN_TOOL,
  run: (ctx: McpCtx, args) => runGetSignedDocumentAdmin(ctx, args as Args),
};
