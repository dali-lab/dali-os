// MCP tool: manage_agreement — Core-only faceted tool for authoring and
// activating signing documents. Actions mirror the admin route intents:
// create · rename · publish · activate. Activation records the pre-signed
// admin-signature counter-signatures placed in the body.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { applyAdminSignatures } from "~/signing/lib/presign.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
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

// ─── Enum arrays (mirrored from admin.agreements.tsx) ────────────────────────

const KINDS: SigningDocumentKind[] = [
  "General",
  "MemberAgreement",
  "MentorshipAgreement",
  "Confidentiality",
];
const SCOPES: SigningGateScope[] = ["None", "App", "HiringCycle"];
const AUDIENCES: SigningAudience[] = [
  "Manual",
  "ActiveMembers",
  "Mentors",
  "HiringParticipants",
];
const CADENCES: SigningCadence[] = ["Once", "PerTerm", "PerCycle"];

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
    "Core-only. Create, rename, publish, or activate a signing document/agreement. Actions: create · rename · publish · activate. Putting a version in force (activate) records the pre-signed admin-signature counter-signatures placed in the body.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "rename", "publish", "activate"],
      },
      documentId: {
        type: "string",
        description: "Required for rename, publish, activate.",
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
        description: "Document kind (create only, defaults to General).",
      },
      gateScope: {
        type: "string",
        enum: ["None", "App", "HiringCycle"],
        description: "Gate scope (create only, defaults to None).",
      },
      audience: {
        type: "string",
        enum: ["Manual", "ActiveMembers", "Mentors", "HiringParticipants"],
        description: "Target audience (create only, defaults to Manual).",
      },
      cadence: {
        type: "string",
        enum: ["Once", "PerTerm", "PerCycle"],
        description: "Signing cadence (create only, defaults to Once).",
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
  cadence?: string;
};

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
  });

  // ─── create ──────────────────────────────────────────────────────────────

  if (args.action === "create") {
    const name = args.name!.trim();
    if (!name) throw new McpInvalidError("Name is required.");
    const kind = args.kind as SigningDocumentKind;
    const gateScope = args.gateScope as SigningGateScope;
    const audience = args.audience as SigningAudience;
    const cadence = args.cadence as SigningCadence;

    const doc = await prisma.signingDocument.create({
      data: {
        name,
        slug: await uniqueSlug(slugify(name)),
        kind: KINDS.includes(kind) ? kind : "General",
        gateScope: SCOPES.includes(gateScope) ? gateScope : "None",
        audience: AUDIENCES.includes(audience) ? audience : "Manual",
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

  // requireForAction handles unknown actions — this is unreachable.
  throw new McpInvalidError("Unknown action.");
}

export const MANAGE_AGREEMENT: McpTool = {
  def: MANAGE_AGREEMENT_TOOL,
  run: (ctx: McpCtx, args) => runManageAgreement(ctx, args as Args),
};
