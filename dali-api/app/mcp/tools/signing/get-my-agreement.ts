import { prisma } from "~/lib/db.server";
import { collectSigningFields } from "~/lib/signing-fields";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { getBindingStateForUser, getSignerCohortsForBinding } from "~/signing/lib/state.server";
import { resolveSigningVariablesForSigner } from "~/signing/lib/variables.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import {
  McpNotFoundError,
  McpForbiddenError,
  type McpTool,
  type McpCtx,
} from "../../registry";

export const GET_MY_AGREEMENT_TOOL = {
  name: "get_my_agreement",
  description:
    "Read one agreement binding as the caller. view to_sign (default) returns the body, signing fields and merge variables, so you can inspect it before sign_document; it needs the caller to be in the audience or to have signed already. view signed returns the caller's own signed copy: signature id, version, typed name and signing time.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bindingId: {
        type: "string",
        description: "A binding id from list_my_agreements.",
      },
      view: {
        type: "string",
        enum: ["to_sign", "signed"],
        description: "to_sign or signed. Defaults to to_sign.",
      },
    },
    required: ["bindingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { bindingId: string; view?: "to_sign" | "signed" };

function isLegacyBody(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in (value as object) &&
    (value as { type: unknown }).type === "doc"
  );
}

async function runToSign(ctx: McpCtx, args: Args) {
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

  const inAudience = AUDIENCE_RESOLVERS[binding.document.audience].includes(cohorts);
  if (state.status !== "signed" && !inAudience) {
    throw new McpForbiddenError("You are not in the audience for this agreement.");
  }

  const supervisorName = binding.signatures[0]?.typedName ?? "";
  const variables = await resolveSigningVariablesForSigner(userId, {
    supervisorName,
    termCode: binding.term?.code ?? undefined,
    role: "member",
    termId: binding.termId ?? undefined,
  });

  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);

  return {
    bindingId,
    documentName: binding.document.name,
    status: state.status,
    body,
    bodyWasLegacy: isLegacyBody(binding.version.body),
    variables,
    fields,
  };
}

async function runSigned(ctx: McpCtx, args: Args) {
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
          document: { select: { name: true } },
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
    versionNumber: sig.binding.version.versionNumber,
    signedAt: sig.signedAt.toISOString(),
    typedName: sig.typedName,
    frozenBodyIsLegacy: isLegacyBody(archiveBody),
  };
}

export async function runGetMyAgreement(ctx: McpCtx, args: Args & { view: "signed" }): ReturnType<typeof runSigned>;
export async function runGetMyAgreement(ctx: McpCtx, args: Args & { view?: "to_sign" }): ReturnType<typeof runToSign>;
export async function runGetMyAgreement(
  ctx: McpCtx,
  args: Args,
): Promise<Awaited<ReturnType<typeof runSigned | typeof runToSign>>>;
export async function runGetMyAgreement(ctx: McpCtx, args: Args) {
  return args.view === "signed" ? runSigned(ctx, args) : runToSign(ctx, args);
}

export const GET_MY_AGREEMENT: McpTool = {
  def: GET_MY_AGREEMENT_TOOL,
  run: (ctx: McpCtx, args) => runGetMyAgreement(ctx, args as Args),
};
