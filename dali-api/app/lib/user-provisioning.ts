import { prisma } from "~/lib/db";
import { linkCasToGoogleUser } from "~/lib/linking";

// Shared user-provisioning helpers used by all four auth callbacks
// (/auth/callback/{google,cas} and /oauth/callback/{google,cas}).
//
// Prior to this module, each callback inlined its own upsert logic and the
// two Google paths had drifted in three ways:
//   - first-party auto-created a DALIMember row for @dali.dartmouth.edu
//     accounts; OAuth-provider did not
//   - OAuth-provider persisted googleAccessToken / googleRefreshToken /
//     googleTokenExpiresAt on the User row; first-party did not
//   - first-party handled all three branches (member / dartmouth / partner);
//     OAuth-provider only handled the member branch and rejected the rest
//
// Unified behavior here:
//   - both Google callbacks auto-create the DALIMember row on the
//     @dali.dartmouth.edu branch. The MCP `requireMembership` constraint
//     (see dali-os-mcp.md) is satisfied by row existence.
//   - neither callback persists googleAccessToken / RT / expiresAt on User.
//     That belonged to the calendar-link / gmail flows and has been moved
//     out of the standard login path. Calendar tokens land in
//     UserCalendarLink via /oauth/calendar/google/start, gmail tokens via
//     /admin/authorize-gmail. The OAuth provider Google authorize URL no
//     longer requests calendar.readonly scope either (see
//     lib/oauth.ts → calendar scope stripped).
//   - both callbacks handle all three account-type branches. Whether a
//     given branch is acceptable for the calling route is a separate
//     concern (e.g. an MCP client's OAuthClient row has
//     `requiredAccountType: "member"` and the caller rejects upstream).

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

export type GoogleAuthType = "member" | "dartmouth" | "partner";

export type ProvisionedGoogleUser = {
  user: { id: string; netId: string | null };
  authType: GoogleAuthType;
};

export async function upsertUserFromGoogle(
  google: GoogleClaims,
): Promise<ProvisionedGoogleUser> {
  if (google.email.endsWith("@dali.dartmouth.edu")) {
    const user = await prisma.user.upsert({
      where: { daliEmail: google.email },
      update: { firstName: google.firstName, lastName: google.lastName },
      create: {
        daliEmail: google.email,
        firstName: google.firstName,
        lastName: google.lastName,
      },
    });

    // Ensure a DALIMember row exists. Unifies the prior asymmetry where
    // first-party login auto-created and the OAuth provider didn't.
    const existingMember = await prisma.dALIMember.findFirst({
      where: { OR: [{ userId: user.id }, { daliEmail: google.email }] },
    });
    if (existingMember) {
      if (!existingMember.userId) {
        await prisma.dALIMember.update({
          where: { id: existingMember.id },
          data: { userId: user.id },
        });
      }
    } else {
      await prisma.dALIMember.create({
        data: { userId: user.id, daliEmail: google.email },
      });
    }

    return { user, authType: "member" };
  }

  if (google.email.endsWith("@dartmouth.edu")) {
    const user = await prisma.user.upsert({
      where: { dartmouthEmail: google.email },
      update: { firstName: google.firstName, lastName: google.lastName },
      create: {
        dartmouthEmail: google.email,
        firstName: google.firstName,
        lastName: google.lastName,
      },
    });
    return { user, authType: "dartmouth" };
  }

  // External partner — any other Google account. Stored in `dartmouthEmail`
  // because there's no separate column today (known schema-naming wart —
  // see dali-os-mcp.md "Known auth-surface issues" #D). findFirst+create
  // because there is no unique index on `dartmouthEmail` for generic
  // (non-Dartmouth) emails.
  const existing = await prisma.user.findFirst({
    where: { dartmouthEmail: google.email },
  });
  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { firstName: google.firstName, lastName: google.lastName },
    });
    return { user, authType: "partner" };
  }
  const user = await prisma.user.create({
    data: {
      dartmouthEmail: google.email,
      firstName: google.firstName,
      lastName: google.lastName,
    },
  });
  return { user, authType: "partner" };
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
