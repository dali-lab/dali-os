import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { upsertInvoice, setInvoiceStatus } from "./partner-finance.server";
import {
  linkProjectPartner,
  unlinkProjectPartner,
  updateProjectPartnerDates,
} from "./partner-access";
import {
  createPartnerInvite,
  revokePartnerInvite,
} from "./invites.server";
import {
  classifyPartnerEmail,
  issuePartnerMagicLink,
  normalizeEmail,
} from "./magic-link.server";
import { logPartnerActivity } from "./partner-activity.server";
import { isPartnerOrgType, planOrgMerge } from "./partner-org";

export type PartnerOrgActionOrg = {
  id: string;
  name: string;
  primaryContactId: string | null;
  isIndividual: boolean;
};

export type PartnerOrgActionContext = {
  form: FormData;
  org: PartnerOrgActionOrg;
  userId: string;
  request: Request;
  actor: { actorUserId: string; request: Request };
};

export type PartnerOrgActionResult = { error: string } | { ok: true; invited?: true } | Response;

type OrgActionHandler = (ctx: PartnerOrgActionContext) => Promise<PartnerOrgActionResult>;

const orgDetails: OrgActionHandler = async ({ form, org, userId, request }) => {
  const name = (form.get("name") as string | null)?.trim() ?? "";
  if (!name) return { error: "A name is required." };
  const isIndividual = form.get("isIndividual") === "on";

  // CRM fields (spec §7 Settings): shared by both the individual and the
  // organization branch below.
  const typeRaw = (form.get("type") as string | null) ?? "";
  const type = isPartnerOrgType(typeRaw) ? typeRaw : null;
  const address = (form.get("address") as string | null)?.trim() || null;
  const legalEntityName = (form.get("legalEntityName") as string | null)?.trim() || null;
  const tags = ((form.get("tags") as string | null) ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const notes = (form.get("notes") as string | null)?.trim() || null;
  const showcaseConsent = form.get("showcaseConsent") === "on";
  const referredByContactId = (form.get("referredByContactId") as string | null) || null;
  if (referredByContactId) {
    const referrer = await prisma.partnerContact.findUnique({
      where: { id: referredByContactId },
      select: { id: true },
    });
    if (!referrer) return { error: "Referred-by contact not found." };
  }
  const crmFields = { type, address, legalEntityName, tags, notes, showcaseConsent, referredByContactId };

  if (isIndividual) {
    // An individual's name + email live on their sole contact. The org keeps
    // no website/logo, and its primary contact stays that person. Legacy
    // individuals created before this fix have no membership yet, so we set
    // one up here (the lazy heal).
    const email = normalizeEmail((form.get("email") as string | null) ?? "");
    if (!email.includes("@")) {
      return { error: "An email is required for an individual partner." };
    }
    const identity = await classifyPartnerEmail(email);
    if (identity.kind === "member-conflict") {
      return {
        error:
          "That address belongs to a DALI member or Dartmouth account. Partners use a separate work email.",
      };
    }
    const membership = await prisma.partnerMembership.findFirst({
      where: { orgId: org.id, endedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, contactId: true },
    });
    try {
      await prisma.$transaction(async (tx) => {
        if (membership) {
          await tx.partnerContact.update({
            where: { id: membership.contactId },
            data: { name, email },
          });
          await tx.partnerOrg.update({
            where: { id: org.id },
            data: {
              name,
              isIndividual: true,
              website: null,
              logoUrl: null,
              primaryContactId: org.primaryContactId ?? membership.id,
              ...crmFields,
            },
          });
        } else {
          const contact = await tx.partnerContact.upsert({
            where: { email },
            create: { email, name },
            update: { name },
            select: { id: true },
          });
          const created = await tx.partnerMembership.create({
            data: { contactId: contact.id, orgId: org.id },
            select: { id: true },
          });
          await tx.partnerOrg.update({
            where: { id: org.id },
            data: {
              name,
              isIndividual: true,
              website: null,
              logoUrl: null,
              primaryContactId: created.id,
              ...crmFields,
            },
          });
        }
      });
    } catch (e) {
      // PartnerContact.email is unique — collision means another contact
      // already owns this address.
      if ((e as { code?: string })?.code === "P2002") {
        return { error: "Another partner already uses that email address." };
      }
      throw e;
    }
    await logAuditEvent({
      action: "partner.org.update",
      userId: userId,
      targetId: org.id,
      request,
    });
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: userId,
      type: "OrgUpdated",
    });
    return { ok: true };
  }

  const primaryContactId =
    (form.get("primaryContactId") as string | null) || null;
  if (primaryContactId) {
    const contact = await prisma.partnerMembership.findFirst({
      where: { id: primaryContactId, orgId: org.id, endedAt: null },
      select: { id: true },
    });
    if (!contact) return { error: "Primary contact must belong to this organization." };
  }
  await prisma.partnerOrg.update({
    where: { id: org.id },
    data: {
      name,
      website: (form.get("website") as string | null)?.trim() || null,
      logoUrl: (form.get("logoUrl") as string | null)?.trim() || null,
      isIndividual: false,
      primaryContactId,
      ...crmFields,
    },
  });
  await logAuditEvent({
    action: "partner.org.update",
    userId: userId,
    targetId: org.id,
    request,
  });
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "OrgUpdated",
  });
  return { ok: true };
};

const sendSigninLink: OrgActionHandler = async ({ org, request }) => {
  // Individual partners already have their contact + membership; portal
  // access is a self-service magic link, not the teammate-invite flow
  // (that path would create a second membership and hit the unique index).
  const membership = await prisma.partnerMembership.findFirst({
    where: { orgId: org.id, endedAt: null },
    orderBy: { createdAt: "asc" },
    select: { contact: { select: { email: true } } },
  });
  const email = membership?.contact.email;
  if (!email) return { error: "This partner has no contact email yet." };
  const result = await issuePartnerMagicLink(email, request);
  if ("rateLimited" in result) {
    return {
      error: "Too many sign-in links were just sent. Try again in a few minutes.",
    };
  }
  return { ok: true };
};

const memberRole: OrgActionHandler = async ({ form, org, userId, request }) => {
  const membershipId = form.get("partnerUserId") as string;
  const role = (form.get("displayRole") as string | null)?.trim() || null;
  const res = await prisma.partnerMembership.updateMany({
    where: { id: membershipId, orgId: org.id, endedAt: null },
    data: { role },
  });
  if (res.count !== 1) return { error: "Member not found." };
  await logAuditEvent({
    action: "partner.member.update",
    userId: userId,
    targetId: membershipId,
    metadata: { orgId: org.id },
    request,
  });
  return { ok: true };
};

const memberSetPrimary: OrgActionHandler = async ({ form, org, userId, request }) => {
  const membershipId = form.get("membershipId") as string;
  const member = await prisma.partnerMembership.findFirst({
    where: { id: membershipId, orgId: org.id, endedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Member not found." };
  await prisma.partnerOrg.update({
    where: { id: org.id },
    data: { primaryContactId: membershipId },
  });
  await logAuditEvent({
    action: "partner.org.update",
    userId: userId,
    targetId: org.id,
    metadata: { primaryContactId: membershipId },
    request,
  });
  return { ok: true };
};

const memberAdd: OrgActionHandler = async ({ form, org, userId, request }) => {
  const contactId = form.get("contactId") as string;
  if (!contactId) return { error: "Choose a contact to add." };
  const contact = await prisma.partnerContact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) return { error: "Contact not found." };
  // Upsert on the (contactId, orgId) unique pair rather than a plain
  // create: a contact who was previously removed from this org still has
  // a (soft-ended) row that a plain create would collide with.
  await prisma.partnerMembership.upsert({
    where: { contactId_orgId: { contactId, orgId: org.id } },
    create: { contactId, orgId: org.id },
    update: { endedAt: null },
  });
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "MemberAdded",
    metadata: { contactId },
  });
  await logAuditEvent({
    action: "partner.member.update",
    userId: userId,
    targetId: org.id,
    metadata: { addedContactId: contactId },
    request,
  });
  return { ok: true };
};

const memberMove: OrgActionHandler = async ({ form, org, userId, request }) => {
  // "partnerUserId" hidden field name preserved for UI compatibility.
  const membershipId = form.get("partnerUserId") as string;
  const targetOrgId = (form.get("targetOrgId") as string | null) ?? "";
  if (!targetOrgId) return { error: "Choose an organization to move them to." };
  if (targetOrgId === org.id) {
    return { error: "They're already in this organization." };
  }
  const [member, target] = await Promise.all([
    prisma.partnerMembership.findFirst({
      where: { id: membershipId, orgId: org.id, endedAt: null },
      select: { id: true, contactId: true },
    }),
    prisma.partnerOrg.findUnique({
      where: { id: targetOrgId },
      select: { id: true },
    }),
  ]);
  if (!member) return { error: "Member not found." };
  if (!target) return { error: "That organization no longer exists." };
  await prisma.$transaction(async (tx) => {
    // Primary contact doesn't travel — the source org just loses it.
    if (org.primaryContactId === membershipId) {
      await tx.partnerOrg.update({
        where: { id: org.id },
        data: { primaryContactId: null },
      });
    }
    // End the current membership and open a new one in the target org.
    await tx.partnerMembership.update({
      where: { id: membershipId },
      data: { endedAt: new Date() },
    });
    await tx.partnerMembership.create({
      data: { contactId: member.contactId, orgId: targetOrgId },
    });
  });
  await logAuditEvent({
    action: "partner.member.update",
    userId: userId,
    targetId: membershipId,
    metadata: { movedFrom: org.id, movedTo: targetOrgId },
    request,
  });
  return { ok: true };
};

const orgDelete: OrgActionHandler = async ({ org, userId, request }) => {
  // Only a truly empty org may go: members, project links, applications,
  // and pending invites all block. Historical (accepted/revoked/expired)
  // invite rows don't — they're deleted with the org.
  const [memberCount, projectCount, applicationCount, pendingInviteCount] =
    await Promise.all([
      prisma.partnerMembership.count({ where: { orgId: org.id, endedAt: null } }),
      prisma.projectPartner.count({ where: { partnerOrgId: org.id } }),
      prisma.partnerApplication.count({ where: { partnerOrgId: org.id } }),
      prisma.partnerInvite.count({
        where: {
          partnerOrgId: org.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
  // An individual's own self-membership doesn't block — deleting the org
  // cascades it. Projects, applications, and pending invites still do.
  if (
    (!org.isIndividual && memberCount) ||
    projectCount ||
    applicationCount ||
    pendingInviteCount
  ) {
    return {
      error:
        "Only an empty organization can be deleted. This one still has members, projects, applications, or a pending invite.",
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.partnerInvite.deleteMany({ where: { partnerOrgId: org.id } });
    await tx.partnerOrg.delete({ where: { id: org.id } });
  });
  await logAuditEvent({
    action: "partner.org.delete",
    userId: userId,
    targetId: org.id,
    request,
  });
  // Preserve ?embed=1 — dropping it would swap the standalone page for the
  // full workspace shell (or nest a shell inside the workspace iframe).
  const embed = new URL(request.url).searchParams.has("embed");
  return redirect(embed ? "/core/partners/directory?embed=1" : "/core/partners/directory");
};

const memberRemove: OrgActionHandler = async ({ form, org, userId, request }) => {
  // "partnerUserId" hidden field name preserved for UI compatibility.
  const membershipId = form.get("partnerUserId") as string;
  const member = await prisma.partnerMembership.findFirst({
    where: { id: membershipId, orgId: org.id, endedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Member not found." };
  await prisma.$transaction(async (tx) => {
    if (org.primaryContactId === membershipId) {
      await tx.partnerOrg.update({
        where: { id: org.id },
        data: { primaryContactId: null },
      });
    }
    // End the membership — preserves history rather than hard-deleting.
    await tx.partnerMembership.update({
      where: { id: membershipId },
      data: { endedAt: new Date() },
    });
  });
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "MemberRemoved",
    metadata: { membershipId },
  });
  await logAuditEvent({
    action: "partner.member.remove",
    userId: userId,
    targetId: membershipId,
    metadata: { orgId: org.id },
    request,
  });
  return { ok: true };
};

const projectLink: OrgActionHandler = async ({ form, org, userId, actor }) => {
  const projectId = form.get("projectId") as string;
  if (!projectId) return { error: "Select a project." };
  const result = await linkProjectPartner(
    { projectId, partnerOrgId: org.id },
    actor,
  );
  if ("error" in result) return result;
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "ProjectLinked",
    metadata: { projectId },
  });
  return { ok: true };
};

const projectEnd: OrgActionHandler = async ({ form, org, userId, actor }) => {
  const projectPartnerId = form.get("projectPartnerId") as string;
  const existing = await prisma.projectPartner.findFirst({
    where: { id: projectPartnerId, partnerOrgId: org.id },
    select: { startedAt: true, projectId: true },
  });
  if (!existing) return { error: "Partnership not found." };
  const result = await updateProjectPartnerDates(
    { projectPartnerId, startedAt: existing.startedAt, endedAt: new Date() },
    actor,
  );
  if ("error" in result) return result;
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "ProjectEnded",
    metadata: { projectId: existing.projectId },
  });
  return { ok: true };
};

const projectUnlink: OrgActionHandler = async ({ form, org, actor }) => {
  const projectPartnerId = form.get("projectPartnerId") as string;
  const existing = await prisma.projectPartner.findFirst({
    where: { id: projectPartnerId, partnerOrgId: org.id },
    select: { id: true },
  });
  if (!existing) return { error: "Partnership not found." };
  const result = await unlinkProjectPartner(projectPartnerId, actor);
  return "error" in result ? result : { ok: true };
};

const invite: OrgActionHandler = async ({ form, org, userId, request }) => {
  const email = (form.get("email") as string | null) ?? "";
  const displayRole =
    (form.get("displayRole") as string | null)?.trim() || null;
  const result = await createPartnerInvite(
    {
      partnerOrgId: org.id,
      email,
      displayRole,
      invitedByUserId: userId,
    },
    request,
  );
  return "error" in result ? result : { ok: true, invited: true };
};

const revokeInvite: OrgActionHandler = async ({ form, org, userId, request }) => {
  const inviteId = form.get("inviteId") as string;
  const result = await revokePartnerInvite(
    { inviteId, partnerOrgId: org.id, actorUserId: userId },
    request,
  );
  return "error" in result ? result : { ok: true };
};

const note: OrgActionHandler = async ({ form, org, userId }) => {
  // PartnerActivityFeed's built-in composer always posts intent "note" (it
  // isn't parameterized) — this route's action only ever sees its own org's
  // feed, so there's no ambiguity to disambiguate with a more specific name.
  const body = (form.get("body") as string | null)?.trim() ?? "";
  if (!body) return { error: "Note can't be empty." };
  await logPartnerActivity(prisma, {
    orgId: org.id,
    actorUserId: userId,
    type: "Note",
    body,
  });
  return { ok: true };
};

const orgMerge: OrgActionHandler = async ({ form, org, userId, request }) => {
  const survivorId = (form.get("survivorOrgId") as string | null) ?? "";
  if (!survivorId) return { error: "Choose an organization to merge into." };
  if (survivorId === org.id) {
    return { error: "Choose a different organization to merge into." };
  }
  const survivor = await prisma.partnerOrg.findUnique({
    where: { id: survivorId },
    select: { id: true },
  });
  if (!survivor) return { error: "That organization no longer exists." };

  const [sourceMemberships, survivorMemberships, sourceProjectLinks, survivorProjectLinks] =
    await Promise.all([
      prisma.partnerMembership.findMany({
        where: { orgId: org.id, endedAt: null },
        select: { id: true, contactId: true },
      }),
      prisma.partnerMembership.findMany({
        where: { orgId: survivorId, endedAt: null },
        select: { contactId: true },
      }),
      prisma.projectPartner.findMany({
        where: { partnerOrgId: org.id },
        select: { id: true, projectId: true },
      }),
      prisma.projectPartner.findMany({
        where: { partnerOrgId: survivorId },
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
        data: { orgId: survivorId },
      });
    }
    if (plan.projectLinkIdsToRepoint.length > 0) {
      await tx.projectPartner.updateMany({
        where: { id: { in: plan.projectLinkIdsToRepoint } },
        data: { partnerOrgId: survivorId },
      });
    }
    if (plan.projectLinkIdsToRemove.length > 0) {
      // Duplicate links at the survivor — ProjectPartner has no cascade, so
      // these have to go before the source org can be deleted.
      await tx.projectPartner.deleteMany({
        where: { id: { in: plan.projectLinkIdsToRemove } },
      });
    }
    await tx.partnerApplication.updateMany({
      where: { partnerOrgId: org.id },
      data: { partnerOrgId: survivorId },
    });
    // Activities and invoices cascade-delete with the org by default —
    // repoint them first so the history and the receivables survive the
    // merge instead of vanishing with the source row.
    await tx.partnerActivity.updateMany({
      where: { orgId: org.id },
      data: { orgId: survivorId },
    });
    await tx.partnerInvite.updateMany({
      where: { partnerOrgId: org.id },
      data: { partnerOrgId: survivorId },
    });
    await tx.partnerInvoice.updateMany({
      where: { orgId: org.id },
      data: { orgId: survivorId },
    });
    await tx.partnerOrg.delete({ where: { id: org.id } });
    await logPartnerActivity(tx, {
      orgId: survivorId,
      actorUserId: userId,
      type: "OrgUpdated",
      metadata: { mergedFromOrgId: org.id, mergedFromName: org.name },
    });
  });
  await logAuditEvent({
    action: "partner.org.update",
    userId: userId,
    targetId: survivorId,
    metadata: { merged: true, mergedFromOrgId: org.id },
    request,
  });

  const embed = new URL(request.url).searchParams.has("embed");
  return redirect(`/core/partners/orgs/${survivorId}${embed ? "?embed=1" : ""}`);
};

const invoiceSave: OrgActionHandler = async ({ form, org }) => {
  const amountRaw = (form.get("amount") as string | null)?.trim() ?? "";
  const amountCents = amountRaw ? Math.round(Number(amountRaw) * 100) : NaN;
  if (!amountRaw || isNaN(amountCents) || amountCents < 0) {
    return { error: "Enter a valid invoice amount." };
  }
  const issuedAtRaw = (form.get("issuedAt") as string | null)?.trim() ?? "";
  const dueAtRaw = (form.get("dueAt") as string | null)?.trim() ?? "";
  await upsertInvoice({
    orgId: org.id,
    amountCents,
    reference: (form.get("reference") as string | null)?.trim() || null,
    note: (form.get("note") as string | null)?.trim() || null,
    issuedAt: issuedAtRaw ? new Date(issuedAtRaw) : null,
    dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
  });
  return { ok: true };
};

const invoiceStatus: OrgActionHandler = async ({ form, userId }) => {
  const invoiceId = (form.get("invoiceId") as string | null) ?? "";
  const status = form.get("status");
  const validStatuses = ["Draft", "Issued", "Paid", "Void"];
  if (!invoiceId || typeof status !== "string" || !validStatuses.includes(status)) {
    return { error: "Invalid invoice status update." };
  }
  const result = await setInvoiceStatus({
    invoiceId,
    status: status as "Draft" | "Issued" | "Paid" | "Void",
    actorUserId: userId,
  });
  if ("error" in result) return { error: result.error };
  return { ok: true };
};

export const PARTNER_ORG_ACTIONS = {
  "org-details": orgDetails,
  "send-signin-link": sendSigninLink,
  "member-role": memberRole,
  "member-set-primary": memberSetPrimary,
  "member-add": memberAdd,
  "member-move": memberMove,
  "org-delete": orgDelete,
  "member-remove": memberRemove,
  "project-link": projectLink,
  "project-end": projectEnd,
  "project-unlink": projectUnlink,
  "invite": invite,
  "revoke-invite": revokeInvite,
  "note": note,
  "org-merge": orgMerge,
  "invoice-save": invoiceSave,
  "invoice-status": invoiceStatus,
} satisfies Record<string, OrgActionHandler>;

export type PartnerOrgIntent = keyof typeof PARTNER_ORG_ACTIONS;

export function isPartnerOrgIntent(intent: string): intent is PartnerOrgIntent {
  return Object.hasOwn(PARTNER_ORG_ACTIONS, intent);
}

export async function runPartnerOrgAction(
  ctx: PartnerOrgActionContext,
  intent: string,
): Promise<PartnerOrgActionResult> {
  if (!isPartnerOrgIntent(intent)) return { error: "Unknown action." };
  return PARTNER_ORG_ACTIONS[intent](ctx);
}
