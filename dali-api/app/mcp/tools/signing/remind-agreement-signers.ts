import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifySignRequest } from "~/signing/lib/notify.server";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpTool,
  type McpCtx,
} from "../../registry";

export const REMIND_AGREEMENT_SIGNERS_TOOL = {
  name: "remind_agreement_signers",
  description:
    "Core-only. Email the people who still need to sign an agreement binding. Limited to once per 24 hours unless force is true.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bindingId: {
        type: "string",
        description: "The binding to remind signers of.",
      },
      force: {
        type: "boolean",
        description: "Skip the 24-hour limit and remind everyone outstanding now. Defaults to false.",
      },
    },
    required: ["bindingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = { bindingId: string; force?: boolean };

export async function runRemindAgreementSigners(ctx: McpCtx, args: Args) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }
  requireForAction("remind", args, { remind: ["bindingId"] });

  const binding = await prisma.signingBinding.findUnique({
    where: { id: args.bindingId },
    select: {
      id: true,
      documentId: true,
      lastRemindedAt: true,
      document: { select: { archivedAt: true } },
    },
  });
  if (!binding || binding.document.archivedAt) {
    throw new McpNotFoundError("Binding not found or its agreement is archived.");
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  const force = args.force ?? false;
  if (
    !force &&
    binding.lastRemindedAt &&
    Date.now() - binding.lastRemindedAt.getTime() < DAY_MS
  ) {
    throw new McpInvalidError(
      "Already reminded in the last 24 hours. Pass force:true to override.",
    );
  }
  await notifySignRequest(args.bindingId, { force: true });
  await prisma.signingBinding.update({
    where: { id: args.bindingId },
    data: { lastRemindedAt: new Date() },
  });
  await logAuditEvent({
    action: "signing.remind",
    userId: ctx.user.id,
    targetId: binding.documentId,
    metadata: { bindingId: args.bindingId, force },
    request: ctx.request,
  });
  return { ok: true };
}

export const REMIND_AGREEMENT_SIGNERS: McpTool = {
  def: REMIND_AGREEMENT_SIGNERS_TOOL,
  run: (ctx: McpCtx, args) => runRemindAgreementSigners(ctx, args as Args),
};
