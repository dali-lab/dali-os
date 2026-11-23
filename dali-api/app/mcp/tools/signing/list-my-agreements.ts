import { listOutstandingBindings, listMySignedDocuments } from "~/signing/lib/state.server";
import { type McpTool, type McpCtx } from "../../registry";

export const LIST_MY_AGREEMENTS_TOOL = {
  name: "list_my_agreements",
  description:
    "List the caller's lab agreements. toSign is what they still need to sign (documentId, documentName, versionId; bindingId for get_my_agreement). signed is their archive, newest first (signatureId, bindingId, documentName, context, signedAt); hiring confidentiality is left out.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: ["to_sign", "signed", "all"],
        description: "Which list to return. Defaults to all.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { status?: "to_sign" | "signed" | "all" };

async function listSigned(userId: string) {
  const docs = await listMySignedDocuments(userId);
  return docs.map((d) => ({
    signatureId: d.signatureId,
    bindingId: d.bindingId,
    documentName: d.documentName,
    context: d.context,
    signedAt: d.signedAt.toISOString(),
  }));
}

export async function runListMyAgreements(ctx: McpCtx, args: Args) {
  const status = args.status ?? "all";
  const [toSign, signed] = await Promise.all([
    status === "signed" ? undefined : listOutstandingBindings(ctx.user.id, { includeMentee: false }),
    status === "to_sign" ? undefined : listSigned(ctx.user.id),
  ]);
  return { ...(toSign && { toSign }), ...(signed && { signed }) };
}

export const LIST_MY_AGREEMENTS: McpTool = {
  def: LIST_MY_AGREEMENTS_TOOL,
  run: (ctx: McpCtx, args) => runListMyAgreements(ctx, args as Args),
};
