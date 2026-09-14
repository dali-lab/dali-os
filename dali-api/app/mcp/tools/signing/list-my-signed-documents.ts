// MCP tool: list_my_signed_documents — mcp:read (member). Returns the caller's
// personal archive of signed lab agreements, newest first. Mirrors the member's
// "My agreements" archive; hiring Confidentiality (gateScope HiringCycle) is
// excluded because it's hiring-internal.
// Reuses listMySignedDocuments from app/signing/lib/state.server.ts directly.

import { listMySignedDocuments } from "~/signing/lib/state.server";
import { type McpTool, type McpCtx } from "../../registry";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const LIST_MY_SIGNED_DOCUMENTS_TOOL = {
  name: "list_my_signed_documents",
  description:
    "Return the caller's personal archive of signed lab agreements (member role only — not hiring confidentiality), newest first. Each item includes the signatureId (link into get_signed_document), bindingId, documentName, context (term code / cycle name / 'Lab-wide'), and signedAt ISO timestamp.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListMySignedDocuments(ctx: McpCtx) {
  const docs = await listMySignedDocuments(ctx.user.id);
  return {
    documents: docs.map((d) => ({
      signatureId: d.signatureId,
      bindingId: d.bindingId,
      documentName: d.documentName,
      context: d.context,
      signedAt: d.signedAt.toISOString(),
    })),
  };
}

export const LIST_MY_SIGNED_DOCUMENTS: McpTool = {
  def: LIST_MY_SIGNED_DOCUMENTS_TOOL,
  run: (ctx: McpCtx) => runListMySignedDocuments(ctx),
};
