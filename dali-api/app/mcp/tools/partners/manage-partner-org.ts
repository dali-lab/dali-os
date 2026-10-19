// MCP tool: manage_partner_org — create, update, merge, or delete a partner
// organization. Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create — create a new PartnerOrg. Requires name. For an individual partner
//            (isIndividual:true) also requires email; it sets up the person's
//            PartnerContact + PartnerMembership + primary contact.
//   update — update org fields (name, website, logoUrl, isIndividual,
//            primaryContactId, type, address, legalEntityName, tags, notes,
//            showcaseConsent, referredByContactId). Requires orgId and name.
//   merge_into — fold orgId into survivorOrgId: memberships, applications,
//            project links, activities, invites, and invoices repoint (de-
//            duping memberships/project links already on the survivor), then
//            orgId is deleted. Requires orgId and survivorOrgId.
//   delete — delete an empty org. Requires orgId. Blocked if any members, project links,
//             applications, or pending invites exist.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { classifyPartnerEmail, normalizeEmail } from "~/partners/lib/magic-link.server";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { isPartnerOrgType, planOrgMerge } from "~/partners/lib/partner-org";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_ORG_TOOL = {
  name: "manage_partner_org",
  description:
    "Create, update, merge, or delete a partner organization. Action 'create' creates a new org (name required; for an individual partner pass isIndividual:true + email, which sets up the person's contact). Action 'update' edits org details including the CRM fields (orgId + name required). Action 'merge_into' folds orgId into survivorOrgId, deduping memberships and project links, then deletes orgId (both ids required). Action 'delete' removes an empty org (orgId required; blocked if members, projects, applications, or pending invites exist). Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "merge_into", "delete"],
        description: "What to do.",
      },
      orgId: { type: "string", description: "Required for update, merge_into, and delete." },
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
      type: {
        type: "string",
        enum: ["DartmouthDepartment", "FacultyResearch", "Startup", "Nonprofit", "Company", "Alumni", "Other"],
      },
      address: { type: "string" },
      legalEntityName: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
      showcaseConsent: { type: "boolean" },
      referredByContactId: { type: "string", description: "PartnerContact.id who referred this org." },
      survivorOrgId: {
        type: "string",
        description: "Required for merge_into: the organization that orgId merges into.",
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
    merge_into: ["orgId", "survivorOrgId"],
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

    const referredByContactId = (input.referredByContactId as string | undefined) || null;
    if (referredByContactId) {
      const referrer = await prisma.partnerContact.findUnique({
        where: { id: referredByContactId },
        select: { id: true },
      });
      if (!referrer) throw new McpInvalidError("referredByContactId does not match a contact");
    }

    const typeRaw = input.type as string | undefined;
    if (typeRaw !== undefined && !isPartnerOrgType(typeRaw)) {
      throw new McpInvalidError("type must be a valid PartnerOrgType");
    }

    await prisma.partnerOrg.update({
      where: { id: orgId },
      data: {
        name,
        website: (input.website as string | undefined)?.trim() || null,
        logoUrl: (input.logoUrl as string | undefined)?.trim() || null,
        isIndividual: (input.isIndividual as boolean | undefined) ?? false,
        primaryContactId,
        type: typeRaw ?? null,
        address: (input.address as string | undefined)?.trim() || null,
        legalEntityName: (input.legalEntityName as string | undefined)?.trim() || null,
        tags: (input.tags as string[] | undefined) ?? [],
        notes: (input.notes as string | undefined)?.trim() || null,
        showcaseConsent: (input.showcaseConsent as boolean | undefined) ?? false,
        referredByContactId,
      },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: callerId,
      targetId: orgId,
    });
    await logPartnerActivity(prisma, {
      orgId,
      actorUserId: callerId,
      type: "OrgUpdated",
    });
    return { ok: true };
  }

  // ── merge_into ────────────────────────────────────────────────────────────
  if (action === "merge_into") {
    const orgId = input.orgId as string;
    const survivorOrgId = input.survivorOrgId as string;
    if (survivorOrgId === orgId) {
      throw new McpInvalidError("survivorOrgId must be a different organization");
    }
    const [org, survivor] = await Promise.all([
      prisma.partnerOrg.findUnique({ where: { id: orgId }, select: { id: true, name: true } }),
      prisma.partnerOrg.findUnique({ where: { id: survivorOrgId }, select: { id: true } }),
    ]);
    if (!org) throw new McpNotFoundError(`Partner organization ${orgId} not found`);
    if (!survivor) throw new McpNotFoundError(`Partner organization ${survivorOrgId} not found`);

    const [sourceMemberships, survivorMemberships, sourceProjectLinks, survivorProjectLinks] =
      await Promise.all([
        prisma.partnerMembership.findMany({
          where: { orgId, endedAt: null },
          select: { id: true, contactId: true },
        }),
        prisma.partnerMembership.findMany({
          where: { orgId: survivorOrgId, endedAt: null },
          select: { contactId: true },
        }),
        prisma.projectPartner.findMany({
          where: { partnerOrgId: orgId },
          select: { id: true, projectId: true },
        }),
        prisma.projectPartner.findMany({
          where: { partnerOrgId: survivorOrgId },
          select: { projectId: true },
        }),
      ]);

    const plan = planOrgMerge({
      sourceMemberships,
      survivorContactIds: survivorMemberships.map((m) => m.contactId),
      sourceProjectLinks,
      survivorProjectIds: survivorProjectLinks.map((p) => p.projectId),
    });

    await prisma.$transaction(async (tx) => {
      if (plan.membershipIdsToRepoint.length > 0) {
        await tx.partnerMembership.updateMany({
          where: { id: { in: plan.membershipIdsToRepoint } },
          data: { orgId: survivorOrgId },
        });
      }
      if (plan.projectLinkIdsToRepoint.length > 0) {
        await tx.projectPartner.updateMany({
          where: { id: { in: plan.projectLinkIdsToRepoint } },
          data: { partnerOrgId: survivorOrgId },
        });
      }
      if (plan.projectLinkIdsToRemove.length > 0) {
        await tx.projectPartner.deleteMany({
          where: { id: { in: plan.projectLinkIdsToRemove } },
        });
      }
      await tx.partnerApplication.updateMany({
        where: { partnerOrgId: orgId },
        data: { partnerOrgId: survivorOrgId },
      });
      await tx.partnerActivity.updateMany({
        where: { orgId },
        data: { orgId: survivorOrgId },
      });
      await tx.partnerInvite.updateMany({
        where: { partnerOrgId: orgId },
        data: { partnerOrgId: survivorOrgId },
      });
      await tx.partnerInvoice.updateMany({
        where: { orgId },
        data: { orgId: survivorOrgId },
      });
      await tx.partnerOrg.delete({ where: { id: orgId } });
      await logPartnerActivity(tx, {
        orgId: survivorOrgId,
        actorUserId: callerId,
        type: "OrgUpdated",
        metadata: { mergedFromOrgId: orgId, mergedFromName: org.name },
      });
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: callerId,
      targetId: survivorOrgId,
      metadata: { merged: true, mergedFromOrgId: orgId },
    });
    return { ok: true, survivorOrgId };
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
