import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, magicLink, admin } from "better-auth/plugins";

import { prisma } from "~/lib/db";
import { getApiBaseUrl, getFrontendUrl, getAppEnv } from "~/lib/app-env";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";

// Deduplicate the trusted origins list — in single-server deployments
// (Fly staging/prod) getApiBaseUrl() === getFrontendUrl(), so a Set avoids a
// duplicate entry that would appear confusing in logs.
function buildTrustedOrigins(): string[] {
  const api = getApiBaseUrl();
  const frontend = getFrontendUrl();
  // TODO(Phase 2): add the desktop Tauri custom scheme (e.g. "tauri://localhost")
  return api === frontend ? [api] : [frontend, api];
}

export const auth = betterAuth({
  appName: "DALI OS",

  baseURL: getApiBaseUrl(),

  // Passed through to BetterAuth's internal secret resolution. When undefined
  // (local dev without a .env), BetterAuth falls back to its own built-in
  // placeholder — it only throws on that placeholder in NODE_ENV=production,
  // so the module is safe to import in dev without setting this var.
  // In staging/prod BETTER_AUTH_SECRET MUST be set via Fly secrets.
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // Map BetterAuth's `user` model onto the existing `User` table rather than a
  // new one. `image` lives in our existing `photoUrl` column. The identity
  // columns are declared as additionalFields so getSession() returns them on
  // the session user (the compat shim derives the member/dartmouth/partner
  // `type` from daliEmail/netId, exactly like today's buildAuthUser) — but
  // `input: false` keeps them un-settable through the auth API. firstName/
  // lastName are NOT NULL in the schema and are populated from `name` by the
  // create hook below.
  user: {
    // modelName is BetterAuth's Prisma client ACCESSOR key (prisma[modelName]),
    // i.e. the camelCase delegate name — "user" for model `User`, NOT "User".
    modelName: "user",
    fields: { image: "photoUrl" },
    additionalFields: {
      firstName: { type: "string", required: false, input: false },
      lastName: { type: "string", required: false, input: false },
      netId: { type: "string", required: false, input: false },
      daliEmail: { type: "string", required: false, input: false },
      dartmouthEmail: { type: "string", required: false, input: false },
      personalEmail: { type: "string", required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,

    // Callback signature (from @better-auth/core 1.7.5 types):
    //   (data: { user: User; url: string; token: string }, request?: Request) => Promise<void>
    sendResetPassword: async (data, _request) => {
      const { user, url } = data;
      if (getAppEnv() === "dev") {
        console.info(`[betterauth:reset-password:dev] ${url}`);
      }
      const { id: outboundId } = await enqueueOutbound({
        channel: "email",
        purpose: "General",
        dedupKey: `auth.reset_password:${user.id}:${Date.now()}`,
        target: user.email,
        recipientUserId: user.id,
        subject: "Reset your DALI OS password",
        bodyHtml: `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    <p>Someone requested a password reset for your DALI OS account. Use the button below to set a new password. This link expires in one hour.</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Reset your password</a>
    </p>
    <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email — your password won't be changed.</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`,
        eventType: "auth.reset_password",
      });
      await drainNow([outboundId]);
    },
  },

  emailVerification: {
    sendOnSignUp: true,

    // Callback signature (from @better-auth/core 1.7.5 types):
    //   (data: { user: User; url: string; token: string }, request?: Request) => Promise<void>
    sendVerificationEmail: async (data, _request) => {
      const { user, url } = data;
      if (getAppEnv() === "dev") {
        console.info(`[betterauth:verify-email:dev] ${url}`);
      }
      const { id: outboundId } = await enqueueOutbound({
        channel: "email",
        purpose: "General",
        dedupKey: `auth.verify_email:${user.id}`,
        target: user.email,
        recipientUserId: user.id,
        subject: "Verify your email for DALI OS",
        bodyHtml: `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    <p>Welcome to DALI OS! Confirm your email address by clicking the button below.</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Verify email address</a>
    </p>
    <p style="color: #6b7280; font-size: 13px;">If you didn't create a DALI OS account, you can ignore this email.</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`,
        eventType: "auth.verify_email",
      });
      await drainNow([outboundId]);
    },
  },

  // No social providers. Sign-in is passwordless-first: a magic link to the
  // verified email (all doors), with an optional password as a fallback and
  // passkeys for fast repeat sign-in. Google SSO was removed deliberately —
  // not every account we admit is Google-backed (Dartmouth faculty/staff on
  // Microsoft, partners on any provider), and one consistent method across all
  // three doors beats a per-door split.

  account: {
    accountLinking: {
      enabled: true,
      // Google is trusted: a verified google email is sufficient proof of
      // ownership to link an OAuth account to an existing email/password row.
      trustedProviders: ["google"],
    },
  },

  session: {
    // Map to a NEW `AuthSession` table, NOT the bespoke `Session` (sha256-id,
    // grantId→OAuthGrant, absolute expiry) which must keep working through the
    // phased cutover and is dropped only at cleanup. Avoids a model collision.
    modelName: "authSession",
    // 30-day rolling session; updateAge keeps the token fresh after 24 h of use.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // NOTE: do NOT enable `cookieCache` here. It breaks revocation (a banned or
    // deprovisioned user would continue to pass session checks until the cookie
    // expires) and also bypasses the per-request membership check the MCP
    // provider relies on (Phase 4 / §7 of the spec).
    additionalFields: {
      // Phase 4: populated by mintBetterAuthSession when issuing an MCP token.
      // Null for normal browser sessions. `input: false` prevents clients from
      // setting grantId via the BetterAuth session API.
      grantId: { type: "string", required: false, input: false },
    },
  },

  trustedOrigins: buildTrustedOrigins(),

  advanced: {
    cookiePrefix: "dali",
    useSecureCookies: getAppEnv() !== "dev",

    database: {
      // Defer row-id generation to the DB's own @default(cuid()) clauses.
      // CROSS-TASK DEPENDENCY: every BetterAuth model added to schema.prisma
      // (User, Session, Account, Verification, …) MUST have `id String @id
      // @default(cuid())` — otherwise inserts will fail with a missing-id error.
      generateId: false,
    },
  },

  plugins: [
    // bearer: converts an `Authorization: Bearer <token>` header into the
    // session cookie BetterAuth's getSession reads — preserving the same
    // requireAuth() contract used by today's JWT flow and by the MCP provider.
    bearer(),
    // magicLink: powers the "verify email via a one-time link, THEN set a
    // password" onboarding for the Dartmouth and Partner doors (Kiran's chosen
    // flow). Rides the existing `verification` table — no extra schema. The
    // door route gates who may request one (e.g. @dartmouth.edu only); this
    // callback just delivers the link through the transactional outbox.
    magicLink({
      sendMagicLink: async ({ email, url }, _request) => {
        if (getAppEnv() === "dev") {
          console.info(`[betterauth:magic-link:dev] ${url}`);
        }
        const { id: outboundId } = await enqueueOutbound({
          channel: "email",
          purpose: "General",
          // Fresh key each send so a re-request always delivers a new link.
          dedupKey: `auth.magic_link:${email}:${url}`,
          target: email,
          subject: "Your DALI OS sign-in link",
          bodyHtml: `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    <p>Use the button below to sign in to DALI OS. This link works once and expires shortly.</p>
    <p style="margin: 24px 0;">
      <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Sign in to DALI OS</a>
    </p>
    <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`,
          eventType: "auth.magic_link",
        });
        await drainNow([outboundId]);
      },
    }),
    // admin: first-class impersonation (Phase 3), replacing the dev-only
    // dev-login-as hack for prod admins. Our /admin/impersonate route gates on
    // the real AdminMembership authz (isAdmin) and JIT-sets the acting admin's
    // user.role="admin" right before calling auth.api.impersonateUser, so the
    // plugin's own role gate passes WITHOUT a standing role↔AdminMembership
    // sync. The plugin's ban/role-management endpoints exist but are unused —
    // authorization stays in the role tables. Adds columns: user.role/banned/
    // banReason/banExpires + AuthSession.impersonatedBy (see the migration).
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      impersonationSessionDuration: 60 * 60, // 1h (spec §8)
    }),
    // Deferred plugins (do NOT add these until their schemas are in place):
    //   deviceAuthorization() — Phase 2: desktop Tauri device-code flow
    //   apiKey()           — separate @better-auth/api-key package; Phase 3+
    //   organization()     — partner org membership; later phase
    //   jwt() + mcp()      — Phase 4: @better-auth/mcp MCP provider sessions
  ],

  databaseHooks: {
    user: {
      create: {
        // Populate the app's NOT-NULL firstName/lastName from BetterAuth's
        // single `name` field on every user create. This is NOT type
        // classification: the account type (member / dartmouth / partner) comes
        // from WHICH login door the user chose (the 3-way split is preserved),
        // never from the email domain — auto-classification can't tell a DALI
        // student who is also a partner from a plain student. netID capture
        // likewise happens inside the Dartmouth door's flow (bindNetIdByEmail /
        // validateSelfEnteredNetId in ~/lib/dartmouth-lookup), not here.
        before: async (user) => {
          const name = (typeof user.name === "string" ? user.name : "").trim();
          const sp = name.indexOf(" ");
          const firstName = sp === -1 ? name : name.slice(0, sp);
          const lastName = sp === -1 ? "" : name.slice(sp + 1).trim();
          return { data: { ...user, firstName, lastName } };
        },
        // Member provisioning (runs after the row is inserted). A
        // @dali.dartmouth.edu account is unambiguously a lab-provisioned DALI
        // member, so mirror the legacy upsertUserFromGoogle: set the daliEmail
        // column (BetterAuth's Google sign-in only fills the canonical `email`),
        // ensure a DALIMember marker row, and assign a handle. This is
        // domain-conditional, NOT the ambiguous student/partner classification
        // the 3-door split exists to avoid — non-@dali signups skip it entirely.
        after: async (user) => {
          const email =
            typeof user.email === "string" ? user.email.toLowerCase() : "";
          if (!email.endsWith("@dali.dartmouth.edu")) return;
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { daliEmail: email },
            });
            await prisma.dALIMember.upsert({
              where: { userId: user.id },
              update: {},
              create: { userId: user.id },
            });
            const { assignHandleIfMissing } = await import("~/lib/handle");
            await assignHandleIfMissing(user.id);
          } catch (err) {
            console.error(
              `[betterauth] @dali member provisioning failed for user ${user.id}`,
              err,
            );
          }
        },
      },
    },
  },
});
