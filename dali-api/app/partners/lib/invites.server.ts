import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import {
  classifyPartnerEmail,
  generateRawToken,
  hashToken,
  normalizeEmail,
} from "./magic-link.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteResult = { ok: true } | { error: string };

// Shared by partner settings (partners inviting teammates) and the internal
// Core org page. The inviter is authenticated and org-scoped, so unlike the
// magic-link flow, conflicts are reported loudly.
export async function createPartnerInvite(
  params: {
    partnerOrgId: string;
    email: string;
    displayRole?: string | null;
    invitedByUserId: string;
  },
  request?: Request,
): Promise<InviteResult> {
  const email = normalizeEmail(params.email);
  if (!email || !email.includes("@")) return { error: "Enter a valid email address" };

  const identity = await classifyPartnerEmail(email);
  if (identity.kind === "member-conflict") {
    return {
      error:
        "That address belongs to a DALI member or Dartmouth account — partners use a separate (work) email",
    };
  }
  if (identity.kind === "existing") {
    // Check if a PartnerContact linked to this User already has an active
    // membership in this specific org (multi-org is allowed in v2).
    const contact = await prisma.partnerContact.findUnique({
      where: { userId: identity.userId },
      select: {
        memberships: {
          where: { orgId: params.partnerOrgId, endedAt: null },
          select: { id: true },
        },
      },
    });
    if (contact?.memberships.length) {
      return { error: "That person is already a member of this organization" };
    }
    // Note: belonging to OTHER orgs is now fine — multi-org is supported.
  }

  // Re-inviting supersedes any pending invite for the same org + email.
  await prisma.partnerInvite.updateMany({
    where: {
      partnerOrgId: params.partnerOrgId,
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const raw = generateRawToken();
  const invite = await prisma.partnerInvite.create({
    data: {
      partnerOrgId: params.partnerOrgId,
      email,
      displayRole: params.displayRole || null,
      tokenHash: hashToken(raw),
      invitedByUserId: params.invitedByUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { id: true, partnerOrg: { select: { name: true } } },
  });

  const inviter = await prisma.user.findUnique({
    where: { id: params.invitedByUserId },
    select: { firstName: true, lastName: true },
  });
  const inviterName = inviter
    ? [inviter.firstName, inviter.lastName].filter(Boolean).join(" ") || null
    : null;

  const url = `${getFrontendUrl()}/partner/invite/${raw}`;
  const invitedBy = inviterName ? `${inviterName} invited you` : "You've been invited";
  const { id: outboundId } = await enqueueOutbound({
    channel: "email",
    purpose: "Partners",
    dedupKey: `partner.invite:${invite.id}`,
    target: email,
    subject: `You've been invited to join ${invite.partnerOrg.name} on DALI OS`,
    bodyHtml: `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    <p>${invitedBy} to join <strong>${invite.partnerOrg.name}</strong> on DALI OS, the DALI Lab partner portal.</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Accept invitation</a>
    </p>
    <p style="color: #6b7280; font-size: 13px;">This invitation expires in 7 days.</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`,
    eventType: "partner.invite",
  });
  await drainNow([outboundId]);
  await logAuditEvent({
    action: "partner.invited",
    userId: params.invitedByUserId,
    targetId: params.partnerOrgId,
    metadata: { inviteId: invite.id },
    request,
  });

  return { ok: true };
}

// Read-only validity check for the GET landing page (see magic-link peek).
export async function peekPartnerInvite(
  raw: string,
): Promise<{ orgName: string; email: string } | null> {
  const invite = await prisma.partnerInvite.findFirst({
    where: {
      tokenHash: hashToken(raw),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { email: true, partnerOrg: { select: { name: true } } },
  });
  if (!invite) return null;
  return { orgName: invite.partnerOrg.name, email: invite.email };
}

export type AcceptInviteResult =
  | { userId: string; partnerOrgId: string }
  | { error: string };

// Atomic consume (same updateMany-guard pattern as the magic link), then
// find-or-create a PartnerContact by email and create a PartnerMembership.
export async function acceptPartnerInvite(
  raw: string,
  request?: Request,
): Promise<AcceptInviteResult> {
  const tokenHash = hashToken(raw);
  const res = await prisma.partnerInvite.updateMany({
    where: {
      tokenHash,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { acceptedAt: new Date() },
  });
  if (res.count !== 1) return { error: "This invitation is invalid or has expired" };

  const invite = await prisma.partnerInvite.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, displayRole: true, partnerOrgId: true },
  });
  if (!invite) return { error: "This invitation is invalid or has expired" };

  // The invitee's identity may have changed since the invite was sent
  // (became a member) — re-check at accept time.
  const identity = await classifyPartnerEmail(invite.email);
  if (identity.kind === "member-conflict") {
    return { error: "This email now belongs to a DALI account — sign in at /login instead" };
  }

  // Find or create the User row. Invitees accepting before they've ever signed
  // in may not have a User yet — we create a minimal one here.
  let userId: string | null = null;
  if (identity.kind === "existing") {
    userId = identity.userId;
  } else {
    userId = (
      await prisma.user.create({
        data: { personalEmail: invite.email, firstName: "", lastName: "" },
        select: { id: true },
      })
    ).id;
  }

  // Upsert the PartnerContact by email (the guard will link userId at first
  // sign-in if the contact was created here without a live session).
  const contact = await prisma.partnerContact.upsert({
    where: { email: invite.email },
    create: {
      email: invite.email,
      name: invite.email.split("@")[0] ?? invite.email,
      ...(userId ? { userId } : {}),
    },
    update: {
      // Only set userId if the contact doesn't have one yet.
      ...(userId ? { userId } : {}),
    },
    select: { id: true },
  });

  try {
    await prisma.partnerMembership.create({
      data: {
        contactId: contact.id,
        orgId: invite.partnerOrgId,
        role: invite.displayRole,
      },
    });
  } catch (e) {
    // @@unique([contactId, orgId]) — this contact is already a member of this org.
    if ((e as { code?: string })?.code === "P2002") {
      return { error: "This account is already a member of this organization" };
    }
    throw e;
  }

  // userId is always set here: either from an existing User or freshly created.
  const resolvedUserId = userId!;
  await logAuditEvent({
    action: "partner.invite.accepted",
    userId: resolvedUserId,
    targetId: invite.partnerOrgId,
    metadata: { inviteId: invite.id },
    request,
  });

  return { userId: resolvedUserId, partnerOrgId: invite.partnerOrgId };
}

export async function revokePartnerInvite(
  params: { inviteId: string; partnerOrgId: string; actorUserId: string },
  request?: Request,
): Promise<InviteResult> {
  const res = await prisma.partnerInvite.updateMany({
    where: {
      id: params.inviteId,
      // Scope to the caller's org so a forged id can't revoke elsewhere.
      partnerOrgId: params.partnerOrgId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (res.count !== 1) return { error: "Invite not found" };
  await logAuditEvent({
    action: "partner.invite.revoked",
    userId: params.actorUserId,
    targetId: params.partnerOrgId,
    metadata: { inviteId: params.inviteId },
    request,
  });
  return { ok: true };
}

export function listPendingInvites(partnerOrgId: string) {
  return prisma.partnerInvite.findMany({
    where: {
      partnerOrgId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      displayRole: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}
