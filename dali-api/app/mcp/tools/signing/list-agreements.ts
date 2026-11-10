// MCP tool: list_agreements — mcp:admin (Core read). Returns the agreements
// console overview: every non-archived agreement with its binding status,
// roster completion, and a recent-signatures feed. Mirrors the /core/agreements
// loader (getAgreementsOverview). Dates are serialized to ISO strings for MCP
// transport.

import { isCore } from "~/lib/roles";
import { getAgreementsOverview } from "~/signing/lib/console.server";
import {
  McpForbiddenError,
  type McpTool,
  type McpCtx,
} from "../../registry";

// ─── Tool definition ──────────────────────────────────────────────────────────

export const LIST_AGREEMENTS_TOOL = {
  name: "list_agreements",
  description:
    "Core-only. Return the agreements console overview for a term: every non-archived agreement with its binding status, signatory roster (signed / outstanding), needs-activation flag, and a recent-signatures activity feed of the latest 15 (activityMayBeTruncated is true when there may be more; use list_agreement_signatures for a full list). Bindings are limited to the current term by default, with pastBindingCount giving how many were left out; pass includePastBindings to return them all. Pass termId to focus on a specific term (e.g. an upcoming term); defaults to the current term.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: {
        type: "string",
        description:
          "Optional term id to focus the console on. Defaults to the current term. Accepts upcoming terms so Core can manage agreements before a term starts.",
      },
      includePastBindings: {
        type: "boolean",
        description: "Return bindings for past terms too. Default false.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

const ACTIVITY_FEED_LIMIT = 15;

type Args = { termId?: string; includePastBindings?: boolean };

export async function runListAgreements(ctx: McpCtx, args: Args = {}) {
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  const overview = await getAgreementsOverview({ termId: args.termId });

  return {
    termId: overview.termId,
    termCode: overview.termCode,
    agreements: overview.agreements.map((a) => ({
      id: a.id,
      name: a.name,
      gateScope: a.gateScope,
      audience: a.audience,
      cadence: a.cadence,
      versionCount: a.versionCount,
      publishedCount: a.publishedCount,
      draftPending: a.draftPending,
      latestPublishedVersionId: a.latestPublishedVersionId,
      needsActivation: a.needsActivation,
      pendingRecipients: a.pendingRecipients,
      pastBindingCount: args.includePastBindings ? 0 : a.bindings.filter((b) => !b.isCurrent).length,
      bindings: a.bindings
        .filter((b) => args.includePastBindings || b.isCurrent)
        .map((b) => ({
          bindingId: b.bindingId,
          versionNumber: b.versionNumber,
          scopeKey: b.scopeKey,
          scopeLabel: b.scopeLabel,
          termId: b.termId,
          isCurrent: b.isCurrent,
          signedCount: b.signedCount,
          total: b.total,
          outstanding: b.outstanding,
          lastRemindedAt: b.lastRemindedAt ? b.lastRemindedAt.toISOString() : null,
        })),
    })),
    activityMayBeTruncated: overview.activity.length >= ACTIVITY_FEED_LIMIT,
    activity: overview.activity.map((a) => ({
      signatureId: a.signatureId,
      documentId: a.documentId,
      documentName: a.documentName,
      signerName: a.signerName,
      signedAt: a.signedAt.toISOString(),
    })),
  };
}

export const LIST_AGREEMENTS: McpTool = {
  def: LIST_AGREEMENTS_TOOL,
  run: (ctx: McpCtx, args) => runListAgreements(ctx, args as Args),
};
