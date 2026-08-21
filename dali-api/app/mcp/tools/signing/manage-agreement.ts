// MCP tool: manage_agreement — Core-only faceted tool for authoring and
// activating signing documents. Actions mirror the admin route intents:
// create · rename · publish · activate · update. Activation records the
// pre-signed admin-signature counter-signatures placed in the body; update
// edits the config facets (kind / gate scope / audience / cadence).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { applyAdminSignatures } from "~/signing/lib/presign.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { KINDS, SCOPES, AUDIENCES, CADENCES } from "~/signing/lib/document-config";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpTool,
  type McpCtx,
} from "../../registry";
import type {
  SigningDocumentKind,
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "agreement"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (
    await prisma.signingDocument.findUnique({ where: { slug }, select: { id: true } })
  ) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const MANAGE_AGREEMENT_TOOL = {
  name: "manage_agreement",
  description:
    "Core-only. Create, rename, publish, activate, or update a signing document/agreement. Actions: create · rename · publish · activate · update. Putting a version in force (activate) records the pre-signed admin-signature counter-signatures placed in the body. Update edits the config facets (kind / gate scope / audience / cadence) on an existing document.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "rename", "publish", "activate", "update"],
      },
      documentId: {
        type: "string",
        description: "Required for rename, publish, activate, update.",
      },
      versionId: {
        type: "string",
        description: "Required for publish, activate.",
      },
      name: {
        type: "string",
        description: "Document name. Required for create; used by rename.",
      },
      kind: {
        type: "string",
        enum: ["General", "MemberAgreement", "MentorshipAgreement", "Confidentiality"],
        description: "Document kind. Set on create (defaults to General) or update.",
      },
      gateScope: {
        type: "string",
        enum: ["None", "App", "HiringCycle"],
        description: "Gate scope. Set on create (defaults to None) or update.",
      },
      audience: {
        type: "string",
        enum: ["Manual", "NewMembers", "Members", "Mentors", "HiringParticipants", "Group"],
        description:
          "Target audience. NewMembers = this cycle's General/Fellowship hires; Members = returning active members (not new); Mentors = all mentors; Group = a user group (see audienceGroupId). Set on create (defaults to Manual) or update.",
      },
      audienceGroupId: {
        type: "string",
        description:
          "Only for audience=Group. A GroupDefinition id to target a fixed group; omit (or pass empty) to target the binding's term group — everyone active/staffed that term, so a per-term agreement auto-rolls each term. Ignored for other audiences (cleared).",
      },
      cadence: {
        type: "string",
        enum: ["Once", "PerTerm", "PerCycle"],
        description: "Signing cadence. Set on create (defaults to Once) or update.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Args = {
  action: string;
  documentId?: string;
  versionId?: string;
  name?: string;
  kind?: string;
  gateScope?: string;
  audience?: string;
  audienceGroupId?: string;
  cadence?: string;
};

// Group targeting for a create/update: an explicit id pins a fixed group; its
// absence under audience=Group means the binding's term group; any other
// audience clears it. Returns undefined to leave the column untouched.
function resolveAudienceGroupId(
  audience: SigningAudience | undefined,
  audienceGroupId: string | undefined,
): string | null | undefined {
  if (audience === undefined) return undefined;
  if (audience !== "Group") return null;
  const id = audienceGroupId?.trim();
  return id ? id : null;
}

export async function runManageAgreement(ctx: McpCtx, args: Args) {
  // All actions are Core-only.
  if (!(await isCore(ctx.user.id))) {
    throw new McpForbiddenError("Core only");
  }

  requireForAction(args.action, args, {
    create: ["name"],
    rename: ["documentId", "name"],
    publish: ["documentId", "versionId"],
    activate: ["documentId", "versionId"],
    update: ["documentId"],
  });

  // ─── create ──────────────────────────────────────────────────────────────

  if (args.action === "create") {
    const name = args.name!.trim();
    if (!name) throw new McpInvalidError("Name is required.");
    const kind = args.kind as SigningDocumentKind;
    const gateScope = args.gateScope as SigningGateScope;
    const audience = args.audience as SigningAudience;
    const cadence = args.cadence as SigningCadence;

    const resolvedAudience = AUDIENCES.includes(audience) ? audience : "Manual";
    const doc = await prisma.signingDocument.create({
      data: {
        name,
        slug: await uniqueSlug(slugify(name)),
        kind: KINDS.includes(kind) ? kind : "General",
        gateScope: SCOPES.includes(gateScope) ? gateScope : "None",
        audience: resolvedAudience,
        audienceGroupId: resolveAudienceGroupId(resolvedAudience, args.audienceGroupId) ?? null,
        cadence: CADENCES.includes(cadence) ? cadence : "Once",
      },
      select: { id: true },
    });
    return { documentId: doc.id };
  }

  // ─── rename ───────────────────────────────────────────────────────────────

  if (args.action === "rename") {
    const name = args.name!.trim();
    if (!name) throw new McpInvalidError("Name is required.");
    await prisma.signingDocument.update({
      where: { id: args.documentId! },
      data: { name },
    });
    return { ok: true };
  }

  // ─── publish ──────────────────────────────────────────────────────────────

  if (args.action === "publish") {
    await prisma.signingDocumentVersion.update({
      where: { id: args.versionId! },
      data: { publishedAt: new Date() },
    });
    await logAuditEvent({
      action: "signing.publish",
      userId: ctx.user.id,
      targetId: args.documentId!,
      metadata: { versionId: args.versionId },
      request: ctx.request,
    });
    return { ok: true };
  }

  // ─── activate ─────────────────────────────────────────────────────────────

  if (args.action === "activate") {
    const version = await prisma.signingDocumentVersion.findUnique({
      where: { id: args.versionId! },
      select: { publishedAt: true, body: true },
    });
    if (!version) throw new McpNotFoundError("Version not found.");
    if (!version.publishedAt) {
      throw new McpInvalidError("Publish the version before putting it in force.");
    }

    const doc = await prisma.signingDocument.findUnique({
      where: { id: args.documentId! },
      select: { cadence: true },
    });
    if (!doc) throw new McpNotFoundError("Document not found.");

    const scope = await resolveAdminScope(doc);
    if ("error" in scope) throw new McpInvalidError(scope.error);

    const bound = await prisma.signingBinding.upsert({
      where: {
        documentId_scopeKey: {
          documentId: args.documentId!,
          scopeKey: scope.scopeKey,
        },
      },
      create: {
        documentId: args.documentId!,
        versionId: args.versionId!,
        scopeKey: scope.scopeKey,
        termId: scope.termId ?? null,
        cycleId: scope.cycleId ?? null,
      },
      update: { versionId: args.versionId! },
      select: { id: true },
    });

    // Record the pre-signed staff counter-signatures configured in the body.
    await applyAdminSignatures({
      bindingId: bound.id,
      versionId: args.versionId!,
      body: version.body,
    });

    await logAuditEvent({
      action: "signing.bind",
      userId: ctx.user.id,
      targetId: args.documentId!,
      metadata: { versionId: args.versionId, scopeKey: scope.scopeKey },
      request: ctx.request,
    });
    await notifySignRequest(bound.id);

    return { ok: true, bindingId: bound.id };
  }

  // ─── update ───────────────────────────────────────────────────────────────

  if (args.action === "update") {
    const data: {
      kind?: SigningDocumentKind;
      gateScope?: SigningGateScope;
      audience?: SigningAudience;
      cadence?: SigningCadence;
      audienceGroupId?: string | null;
    } = {};
    if (args.kind !== undefined) {
      if (!KINDS.includes(args.kind as SigningDocumentKind)) throw new McpInvalidError("Invalid kind.");
      data.kind = args.kind as SigningDocumentKind;
    }
    if (args.gateScope !== undefined) {
      if (!SCOPES.includes(args.gateScope as SigningGateScope)) throw new McpInvalidError("Invalid gateScope.");
      data.gateScope = args.gateScope as SigningGateScope;
    }
    if (args.audience !== undefined) {
      if (!AUDIENCES.includes(args.audience as SigningAudience)) throw new McpInvalidError("Invalid audience.");
      data.audience = args.audience as SigningAudience;
      // Keep the target group coherent with the new audience (pin / term group /
      // clear). Only when audience itself is being set.
      data.audienceGroupId = resolveAudienceGroupId(data.audience, args.audienceGroupId);
    }
    if (args.cadence !== undefined) {
      if (!CADENCES.includes(args.cadence as SigningCadence)) throw new McpInvalidError("Invalid cadence.");
      data.cadence = args.cadence as SigningCadence;
    }
    if (Object.keys(data).length === 0) {
      throw new McpInvalidError("Provide at least one of kind, gateScope, audience, cadence to update.");
    }
    const doc = await prisma.signingDocument.findUnique({
      where: { id: args.documentId! },
      select: { id: true },
    });
    if (!doc) throw new McpNotFoundError("Document not found.");
    await prisma.signingDocument.update({ where: { id: args.documentId! }, data });
    await logAuditEvent({
      action: "signing.configure",
      userId: ctx.user.id,
      targetId: args.documentId!,
      metadata: data,
      request: ctx.request,
    });
    return { ok: true };
  }

  // requireForAction handles unknown actions — this is unreachable.
  throw new McpInvalidError("Unknown action.");
}

export const MANAGE_AGREEMENT: McpTool = {
  def: MANAGE_AGREEMENT_TOOL,
  run: (ctx: McpCtx, args) => runManageAgreement(ctx, args as Args),
};
