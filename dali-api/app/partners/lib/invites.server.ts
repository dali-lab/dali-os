import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import {
  classifyPartnerEmail,
  generateRawToken,
  hashToken,
  normalizeEmail,
} from "./magic-link.server";
import { sendPartnerInviteEmail } from "./partner-emails.server";
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
    const partnerUser = await prisma.partnerUser.findUnique({
      where: { userId: identity.userId },
      select: { partnerOrgId: true },
    });
    if (partnerUser?.partnerOrgId === params.partnerOrgId) {
      return { error: "That person is already a member of this organization" };
    }
    if (partnerUser) {
      return { error: "That person already belongs to another partner organization" };
    }
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
  await sendPartnerInviteEmail(email, invite.partnerOrg.name, inviterName, url);
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
// find-or-create the User by personalEmail and attach the PartnerUser row.
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
  // (became a member, joined another org) — re-check at accept time.
  const identity = await classifyPartnerEmail(invite.email);
  if (identity.kind === "member-conflict") {
    return { error: "This email now belongs to a DALI account — sign in at /login instead" };
  }

  const userId =
    identity.kind === "existing"
      ? identity.userId
      : (
          await prisma.user.create({
            data: { personalEmail: invite.email, firstName: "", lastName: "" },
            select: { id: true },
          })
        ).id;

  try {
    await prisma.partnerUser.create({
      data: {
        userId,
        partnerOrgId: invite.partnerOrgId,
        displayRole: invite.displayRole,
        authProvider: "MagicLink",
      },
    });
  } catch (e) {
    // PartnerUser.userId is unique — one org per person in v1.
    if ((e as { code?: string })?.code === "P2002") {
      return { error: "This account already belongs to a partner organization" };
    }
    throw e;
  }

  await logAuditEvent({
    action: "partner.invite.accepted",
    userId,
    targetId: invite.partnerOrgId,
    metadata: { inviteId: invite.id },
    request,
  });

  return { userId, partnerOrgId: invite.partnerOrgId };
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
