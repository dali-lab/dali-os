// MCP tool: list_documents_to_sign — returns the outstanding signing obligations
// for the current user: bindings where the user is in the audience and has not
// yet signed the in-force version.

import { listOutstandingBindings } from "~/signing/lib/state.server";
import type { McpTool, McpCtx } from "../../registry";

export const LIST_DOCUMENTS_TO_SIGN_TOOL = {
  name: "list_documents_to_sign",
  description:
    "List the lab agreements the caller still needs to sign. Returns outstanding bindings (documentId, documentName, kind, versionId) the caller is in the audience for but hasn't signed yet.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListDocumentsToSign(ctx: McpCtx) {
  const documents = await listOutstandingBindings(ctx.user.id);
  return { documents };
}

export const LIST_DOCUMENTS_TO_SIGN: McpTool = {
  def: LIST_DOCUMENTS_TO_SIGN_TOOL,
  run: (ctx: McpCtx) => runListDocumentsToSign(ctx),
};
