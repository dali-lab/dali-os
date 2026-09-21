// MCP tool: manage_partner_org — create, update, or delete a partner organization.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create — create a new PartnerOrg. Requires name. For an individual partner
//            (isIndividual:true) also requires email; it sets up the person's
//            PartnerContact + PartnerMembership + primary contact.
//   update — update org fields (name, website, logoUrl, isIndividual, primaryContactId).
//             Requires orgId and name.
//   delete — delete an empty org. Requires orgId. Blocked if any members, project links,
//             applications, or pending invites exist.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { classifyPartnerEmail, normalizeEmail } from "~/partners/lib/magic-link.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_ORG_TOOL = {
  name: "manage_partner_org",
  description:
    "Create, update, or delete a partner organization. Action 'create' creates a new org (name required; for an individual partner pass isIndividual:true + email, which sets up the person's contact). Action 'update' edits org details (orgId + name required). Action 'delete' removes an empty org (orgId required; blocked if members, projects, applications, or pending invites exist). Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "What to do.",
      },
      orgId: { type: "string", description: "Required for update and delete." },
      name: { type: "string" },
      website: { type: "string" },
      logoUrl: { type: "string" },
      isIndividual: { type: "boolean" },
      email: {
        type: "string",
        description:
          "Required when creating an individual partner: their contact email. Sets up the person's contact + membership.",
      },
      primaryContactId: {
        type: "string",
        description: "PartnerMembership.id to set as primary contact.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerOrg(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner organizations");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    create: ["name"],
    update: ["orgId", "name"],
    delete: ["orgId"],
  });

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const name = (input.name as string).trim();
    if (!name) throw new McpInvalidError("name cannot be empty");

    const isIndividual = (input.isIndividual as boolean | undefined) ?? false;

    // An individual partner is a person: create their contact + membership +
    // primary contact up front (matches the web form and the promotion path)
    // so the org is never an empty husk.
    if (isIndividual) {
      const email = normalizeEmail((input.email as string | undefined) ?? "");
      if (!email.includes("@")) {
        throw new McpInvalidError("email is required for an individual partner");
      }
      const identity = await classifyPartnerEmail(email);
      if (identity.kind === "member-conflict") {
        throw new McpInvalidError(
          "That email belongs to a DALI member or Dartmouth account; partners use a separate work email",
        );
      }
      const org = await prisma.$transaction(async (tx) => {
        const created = await tx.partnerOrg.create({
          data: { name, isIndividual: true },
          select: { id: true, name: true },
        });
        const contact = await tx.partnerContact.upsert({
          where: { email },
          create: { email, name },
          update: { name },
          select: { id: true },
        });
        const membership = await tx.partnerMembership.create({
          data: { contactId: contact.id, orgId: created.id },
          select: { id: true },
        });
        await tx.partnerOrg.update({
          where: { id: created.id },
          data: { primaryContactId: membership.id },
        });
        return created;
      });
      await logAuditEvent({
        action: "partner.org.create",
        userId: callerId,
        targetId: org.id,
        metadata: { via: "mcp", individual: true },
      });
      return { id: org.id, name: org.name };
    }

    const org = await prisma.partnerOrg.create({
      data: {
        name,
        website: (input.website as string | undefined)?.trim() || null,
        isIndividual: false,
      },
      select: { id: true, name: true },
    });
    await logAuditEvent({
      action: "partner.org.create",
      userId: callerId,
      targetId: org.id,
      metadata: { via: "mcp" },
    });
    return { id: org.id, name: org.name };
  }

  // ── update ────────────────────────────────────────────────────────────────
  if (action === "update") {
    const orgId = input.orgId as string;
    const org = await prisma.partnerOrg.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new McpNotFoundError(`Partner organization ${orgId} not found`);

    const name = (input.name as string).trim();
    if (!name) throw new McpInvalidError("name cannot be empty");

    const primaryContactId = (input.primaryContactId as string | undefined) || null;
    if (primaryContactId) {
      const contact = await prisma.partnerMembership.findFirst({
        where: { id: primaryContactId, orgId, endedAt: null },
        select: { id: true },
      });
      if (!contact) {
        throw new McpInvalidError("Primary contact must be an active member of this organization");
      }
    }

    await prisma.partnerOrg.update({
      where: { id: orgId },
      data: {
        name,
        website: (input.website as string | undefined)?.trim() || null,
        logoUrl: (input.logoUrl as string | undefined)?.trim() || null,
        isIndividual: (input.isIndividual as boolean | undefined) ?? false,
        primaryContactId,
      },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: callerId,
      targetId: orgId,
    });
    return { ok: true };
  }

  // ── delete ────────────────────────────────────────────────────────────────
  const orgId = input.orgId as string;
  const org = await prisma.partnerOrg.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org) throw new McpNotFoundError(`Partner organization ${orgId} not found`);

  const [memberCount, projectCount, applicationCount, pendingInviteCount] =
    await Promise.all([
      prisma.partnerMembership.count({ where: { orgId, endedAt: null } }),
      prisma.projectPartner.count({ where: { partnerOrgId: orgId } }),
      prisma.partnerApplication.count({ where: { partnerOrgId: orgId } }),
      prisma.partnerInvite.count({
        where: {
          partnerOrgId: orgId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

  if (memberCount > 0 || projectCount > 0 || applicationCount > 0 || pendingInviteCount > 0) {
    throw new McpInvalidError("Only an empty organization can be deleted");
  }

  await prisma.$transaction(async (tx) => {
    // Historical (accepted/revoked/expired) invites are deleted with the org.
    await tx.partnerInvite.deleteMany({ where: { partnerOrgId: orgId } });
    await tx.partnerOrg.delete({ where: { id: orgId } });
  });
  await logAuditEvent({
    action: "partner.org.delete",
    userId: callerId,
    targetId: orgId,
  });
  return { ok: true };
}
