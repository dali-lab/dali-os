import { prisma } from "~/lib/db";
import { linkCasToGoogleUser } from "~/lib/linking";

// Shared user-provisioning helpers used by /auth/callback/{google,cas} and
// /oauth/callback/{google,cas}.
//
// Phase 2: collapsed to `member` only for Google. The dartmouth (@dartmouth
// .edu Google) and partner (external Google) branches were dead — the
// website login page only offers Google for members and CAS for Dartmouth
// students, and the OAuth-provider path is MCP-only (members-only per
// V0_PLAN.md Q18). Partners auth through magic-link via OneTimeToken (Phase
// 1 model; Partner portal track wires up the UI).

export type GoogleClaims = {
  email: string;
  firstName: string;
  lastName: string;
};

export type CasClaims = {
  netId: string;
  firstName: string;
  lastName: string;
};

// Member is the only Google auth type post-Phase-2. Kept as a type alias
// for clarity and forward compatibility (future expansion may add more).
export type GoogleAuthType = "member";

export type ProvisionedGoogleUser = {
  user: { id: string; netId: string | null };
  authType: GoogleAuthType;
};

export async function upsertUserFromGoogle(
  google: GoogleClaims,
): Promise<ProvisionedGoogleUser> {
  // Member branch only. The non-@dali.dartmouth.edu branches were removed
  // in Phase 2 — they were dead code paths.
  if (!google.email.endsWith("@dali.dartmouth.edu")) {
    throw new Error(
      "upsertUserFromGoogle called with non-@dali.dartmouth.edu email; " +
        "callers must filter upstream (per Phase 2 — OAuth provider is MCP " +
        "members-only and website login enforces the domain in the route).",
    );
  }

  const user = await prisma.user.upsert({
    where: { daliEmail: google.email },
    update: { firstName: google.firstName, lastName: google.lastName },
    create: {
      daliEmail: google.email,
      firstName: google.firstName,
      lastName: google.lastName,
    },
  });

  // Ensure a DALIMember marker row exists for this user. DALIMember.userId
  // is NOT NULL after Phase 2; we upsert by userId.
  await prisma.dALIMember.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  return { user, authType: "member" };
}

export type ProvisionedCasUser = {
  user: { id: string; netId: string | null };
};

// Upsert a User keyed on netId from a CAS service-validate response.
// If `linkUserId` is provided (the OAuth chained Google→CAS flow used when
// a member's Google account has no netId yet), merge the existing Google
// user into the CAS identity via `linkCasToGoogleUser`. Otherwise this is
// a standalone CAS login.
//
// Unifies the prior asymmetry where the first-party CAS callback also
// set `dartmouthEmail = <netId>@dartmouth.edu` and the OAuth-provider CAS
// callback did not.
export async function upsertUserFromCas(
  cas: CasClaims,
  opts: { linkUserId?: string } = {},
): Promise<ProvisionedCasUser> {
  if (opts.linkUserId) {
    const user = await linkCasToGoogleUser(opts.linkUserId, cas.netId);
    return { user };
  }

  const dartmouthEmail = `${cas.netId}@dartmouth.edu`;
  const user = await prisma.user.upsert({
    where: { netId: cas.netId },
    update: {
      ...(cas.firstName && { firstName: cas.firstName }),
      ...(cas.lastName && { lastName: cas.lastName }),
      dartmouthEmail,
    },
    create: {
      netId: cas.netId,
      firstName: cas.firstName,
      lastName: cas.lastName,
      dartmouthEmail,
    },
  });
  return { user };
}
