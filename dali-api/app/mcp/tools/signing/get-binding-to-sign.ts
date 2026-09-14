// MCP tool: get_binding_to_sign — mcp:read (member). Returns the agreement body,
// field definitions, and resolved variables for one binding the caller is about
// to sign. Lets a caller inspect what they're signing before calling sign_document.
// Mirrors the data the sign.$bindingId.tsx loader supplies to the fill surface.

import { prisma } from "~/lib/db";
import { collectSigningFields } from "~/lib/signing-fields";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { getBindingStateForUser, getSignerCohortsForBinding } from "~/signing/lib/state.server";
import { resolveSigningVariablesForSigner } from "~/signing/lib/variables.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";

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

export const GET_BINDING_TO_SIGN_TOOL = {
  name: "get_binding_to_sign",
  description:
    "Return the agreement body, field definitions, and resolved merge variables for a binding the caller must sign — lets a caller inspect the document before calling sign_document. Returns 403 if the caller is not in the audience and has not yet signed; 404 if the binding doesn't exist.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bindingId: {
        type: "string",
        description: "The binding id returned by list_documents_to_sign.",
      },
    },
    required: ["bindingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { bindingId: string };

export async function runGetBindingToSign(ctx: McpCtx, args: Args) {
  const { bindingId } = args;
  const userId = ctx.user.id;

  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      termId: true,
      document: { select: { name: true, audience: true } },
      version: { select: { body: true } },
      term: { select: { code: true } },
      signatures: {
        where: { roleKey: "supervisor" },
        select: { typedName: true },
        take: 1,
      },
    },
  });
  if (!binding) throw new McpNotFoundError("Binding not found.");

  const [state, cohorts] = await Promise.all([
    getBindingStateForUser(userId, bindingId),
    getSignerCohortsForBinding(userId, binding.termId),
  ]);

  // Gate: only members in the audience OR who have already signed may inspect.
  const inAudience = AUDIENCE_RESOLVERS[binding.document.audience].includes(cohorts);
  if (state.status !== "signed" && !inAudience) {
    throw new McpForbiddenError("You are not in the audience for this agreement.");
  }

  const supervisorName = binding.signatures[0]?.typedName ?? "";
  const variables = await resolveSigningVariablesForSigner(userId, {
    supervisorName,
    termCode: binding.term?.code ?? undefined,
  });

  // Convert legacy ProseMirror body to block JSON on read (never rewritten to DB).
  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);

  return {
    bindingId,
    documentName: binding.document.name,
    status: state.status,
    // Block-JSON body with merge-variable placeholders still in place.
    body,
    // Whether the raw stored body was legacy ProseMirror JSON (pre-migration);
    // the returned body has always been converted to block JSON.
    bodyWasLegacy: isLegacyBody(binding.version.body),
    // Merge-variable map so callers can preview what {{term}} etc. will expand to.
    variables,
    // Signing fields the member must fill before sign_document will accept the call.
    fields,
  };
}

export const GET_BINDING_TO_SIGN: McpTool = {
  def: GET_BINDING_TO_SIGN_TOOL,
  run: (ctx: McpCtx, args) => runGetBindingToSign(ctx, args as Args),
};
