import { redirect } from "react-router";
import { requireAuth, type AuthSuccess } from "~/lib/auth";
import { prisma } from "~/lib/db";

// A single org the account belongs to (current membership). A partner can hold
// several of these over time — the portal picks an "active" one for org-scoped
// surfaces and offers a switcher when there is more than one.
export type PartnerMembershipView = {
  id: string;
  orgId: string;
  role: string | null;
  org: {
    id: string;
    name: string;
    logoUrl: string | null;
    website: string | null;
    isIndividual: boolean;
    primaryContactId: string | null;
  };
};

// The account-first context: an authenticated partner *person* (PartnerContact),
// with zero or more org memberships. Org is NOT required — a fresh applicant or
// a logged inquiry has no org until their first project is promoted.
export type PartnerAccountContext = {
  auth: AuthSuccess;
  contact: {
    id: string;
    name: string;
    email: string;
    userId: string;
  };
  memberships: PartnerMembershipView[];
};

const ORG_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  website: true,
  isIndividual: true,
  primaryContactId: true,
} as const;

const MEMBERSHIP_SELECT = {
  id: true,
  orgId: true,
  role: true,
  org: { select: ORG_SELECT },
} as const;

// Best-effort display name from an email local-part, used only as a placeholder
// when we provision a contact before the person has given us their real name
// (they can fix it in onboarding / settings).
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  );
}

// Find the PartnerContact for a signed-in User, provisioning one if needed.
// Resolution order matters: a contact may already exist (a) linked to this
// User, or (b) unlinked, created by Core when it logged this person's inquiry
// from an email — in which case we LINK it rather than create a duplicate
// (PartnerContact.email is unique, so a blind create would collide).
export async function findOrLinkPartnerContact(
  userId: string,
  email: string,
  name?: string,
): Promise<{ id: string; name: string; email: string; userId: string | null }> {
  const normEmail = email.toLowerCase();

  const byUser = await prisma.partnerContact.findUnique({
    where: { userId },
    select: { id: true, name: true, email: true, userId: true },
  });
  if (byUser) return byUser;

  const byEmail = await prisma.partnerContact.findUnique({
    where: { email: normEmail },
    select: { id: true, name: true, email: true, userId: true },
  });
  if (byEmail && (byEmail.userId === null || byEmail.userId === userId)) {
    return prisma.partnerContact.update({
      where: { id: byEmail.id },
      data: { userId, ...(name ? { name } : {}) },
      select: { id: true, name: true, email: true, userId: true },
    });
  }

  try {
    return await prisma.partnerContact.create({
      data: { userId, email: normEmail, name: name || nameFromEmail(email) },
      select: { id: true, name: true, email: true, userId: true },
    });
  } catch (e) {
    // Lost a provisioning race (parallel loaders): re-read the winner.
    if ((e as { code?: string })?.code === "P2002") {
      const existing = await prisma.partnerContact.findUnique({
        where: { userId },
        select: { id: true, name: true, email: true, userId: true },
      });
      if (existing) return existing;
    }
    throw e;
  }
}

// Route guard for every /partner loader AND action. React Router runs
// parent/child loaders in parallel, so the portal layout's redirect does not
// protect children — each partner route must call this itself.
//
// `auth.user.type === "partner"` is a residual category (no daliEmail, no
// netId), not proof of partner status: accepted members sit in that bucket
// while Workspace provisioning is pending (see login.tsx). So members-in-
// provisioning are detected via DALIMember and sent back to the member app;
// everyone else is provisioned a PartnerContact (org optional).
export async function requirePartnerAccount(
  request: Request,
): Promise<PartnerAccountContext> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/partner/login");
  if (auth.user.type === "member") throw redirect("/");
  if (auth.user.type === "dartmouth") throw redirect("/portal");

  let contact = await prisma.partnerContact.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true, name: true, email: true, userId: true },
  });
  if (!contact) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (member) throw redirect("/");
    contact = await findOrLinkPartnerContact(auth.user.sub, auth.user.email);
  }

  const memberships = await prisma.partnerMembership.findMany({
    where: { contactId: contact.id, endedAt: null },
    select: MEMBERSHIP_SELECT,
    orderBy: { createdAt: "asc" },
  });

  return {
    auth,
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      userId: auth.user.sub,
    },
    memberships,
  };
}

// Backwards-compatible name for the account guard. Prefer requirePartnerAccount
// in new code.
export const requirePartner = requirePartnerAccount;

// Org-scoped guard for post-promotion surfaces (a specific project's org).
// Ensures the signed-in account is a current member of `orgId`.
export async function requirePartnerOrgAccess(
  request: Request,
  orgId: string,
): Promise<PartnerAccountContext & { membership: PartnerMembershipView }> {
  const ctx = await requirePartnerAccount(request);
  const membership = ctx.memberships.find((m) => m.orgId === orgId);
  if (!membership) throw redirect("/partner");
  return { ...ctx, membership };
}

// For /partner/onboarding only: an authenticated non-member, non-Dartmouth
// user who may or may not have a PartnerContact / memberships yet.
export async function requirePartnerCandidate(
  request: Request,
): Promise<AuthSuccess> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/partner/login");
  if (auth.user.type === "member") throw redirect("/");
  if (auth.user.type === "dartmouth") throw redirect("/portal");
  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true },
  });
  if (member) throw redirect("/");
  return auth;
}
