import { redirect } from "react-router";
import { requireAuth, type AuthSuccess } from "~/lib/auth";
import { prisma } from "~/lib/db";

export type PartnerContext = {
  auth: AuthSuccess;
  partnerUser: {
    id: string;
    displayRole: string | null;
    partnerOrgId: string;
  };
  org: {
    id: string;
    name: string;
    logoUrl: string | null;
    website: string | null;
    isIndividual: boolean;
    primaryContactId: string | null;
  };
};

// Route guard for every /partner loader AND action. React Router runs
// parent/child loaders in parallel, so the portal layout's redirect does not
// protect children — each partner route must call this itself.
//
// `auth.user.type === "partner"` is a residual category (no daliEmail, no
// netId), not proof of a PartnerUser row: accepted members sit in that bucket
// while Workspace provisioning is pending (see login.tsx). So the gate keys
// off the PartnerUser row, and members-in-provisioning are detected via
// DALIMember and sent back to the member app.
export async function requirePartner(request: Request): Promise<PartnerContext> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/partner/login");
  if (auth.user.type === "member") throw redirect("/");
  if (auth.user.type === "dartmouth") throw redirect("/portal");

  const partnerUser = await prisma.partnerUser.findUnique({
    where: { userId: auth.user.sub },
    select: {
      id: true,
      displayRole: true,
      partnerOrgId: true,
      partnerOrg: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          website: true,
          isIndividual: true,
          primaryContactId: true,
        },
      },
    },
  });
  if (!partnerUser) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (member) throw redirect("/");
    throw redirect("/partner/onboarding");
  }

  return {
    auth,
    partnerUser: {
      id: partnerUser.id,
      displayRole: partnerUser.displayRole,
      partnerOrgId: partnerUser.partnerOrgId,
    },
    org: partnerUser.partnerOrg,
  };
}

export type PartnerAccountContext = {
  auth: AuthSuccess;
  // Null for a partner *applicant*: signed in and able to apply / track their
  // applications, but not yet a member of any organization (the org is created
  // at project promotion). Non-null once they've graduated into an org.
  partnerUser: {
    id: string;
    displayRole: string | null;
    partnerOrgId: string;
  } | null;
  org: PartnerContext["org"] | null;
};

// Looser guard for account-first surfaces (/partner home, /partner/apply,
// /partner/applications/*): admits a signed-in partner-type user whether or
// not they belong to an org yet. Org-scoped routes (projects, settings, team)
// keep using `requirePartner`, which still demands a PartnerUser row.
export async function requirePartnerAccount(
  request: Request,
): Promise<PartnerAccountContext> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/partner/login");
  if (auth.user.type === "member") throw redirect("/");
  if (auth.user.type === "dartmouth") throw redirect("/portal");

  const partnerUser = await prisma.partnerUser.findUnique({
    where: { userId: auth.user.sub },
    select: {
      id: true,
      displayRole: true,
      partnerOrgId: true,
      partnerOrg: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          website: true,
          isIndividual: true,
          primaryContactId: true,
        },
      },
    },
  });
  if (!partnerUser) {
    // A member mid-provisioning lands in the "partner" bucket; bounce them to
    // the member app rather than treating them as a partner applicant.
    const member = await prisma.dALIMember.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (member) throw redirect("/");
    return { auth, partnerUser: null, org: null };
  }

  return {
    auth,
    partnerUser: {
      id: partnerUser.id,
      displayRole: partnerUser.displayRole,
      partnerOrgId: partnerUser.partnerOrgId,
    },
    org: partnerUser.partnerOrg,
  };
}

// For /partner/onboarding only: an authenticated non-member, non-Dartmouth
// user who may or may not have a PartnerUser row yet.
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
