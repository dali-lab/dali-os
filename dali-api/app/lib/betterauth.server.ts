import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { bearer, magicLink, admin, emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

import { prisma } from "~/lib/db";
import { getApiBaseUrl, getFrontendUrl, getAppEnv } from "~/lib/app-env";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { freshKey } from "~/lib/outbound-keys";
import { renderAuthEmail } from "~/email/lib/layout.server";
import {
  signInLinkEmail,
  otpEmail,
  verifyEmailEmail,
  MAGIC_LINK_TTL_SECONDS,
  EMAIL_OTP_TTL_SECONDS,
  VERIFY_EMAIL_TTL_SECONDS,
  type OtpPurpose,
} from "~/email/lib/auth-email";
import { auditPasskeyMutation } from "~/lib/betterauth-passkey-audit.server";
import {
  canonicalizeEmailBody,
  recordProvenEmail,
} from "~/lib/betterauth-email-alias.server";

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

  // Passwordless by design: sign-in is a one-time email code (emailOTP) plus
  // passkeys. No password credential exists, so email+password sign-in and the
  // reset-password endpoints stay off entirely.
  emailAndPassword: {
    enabled: false,
  },

  emailVerification: {
    sendOnSignUp: true,
    // Declared rather than left to BetterAuth's default, so the email's
    // "expires in 1 hour" sentence is derived from the real value.
    expiresIn: VERIFY_EMAIL_TTL_SECONDS,

    // Callback signature (from @better-auth/core 1.7.5 types):
    //   (data: { user: User; url: string; token: string }, request?: Request) => Promise<void>
    sendVerificationEmail: async (data, _request) => {
      const { user, url } = data;
      if (getAppEnv() === "dev") {
        console.info(`[betterauth:verify-email:dev] ${url}`);
      }
      const mail = await renderAuthEmail(verifyEmailEmail({ url }));
      const { id: outboundId } = await enqueueOutbound({
        channel: "email",
        purpose: "General",
        dedupKey: `auth.verify_email:${user.id}`,
        target: user.email,
        recipientUserId: user.id,
        subject: mail.subject,
        bodyHtml: mail.html,
        bodyText: mail.text,
        eventType: "auth.verify_email",
      });
      await drainNow([outboundId]);
    },
  },

  // No social providers, so there is nothing to link: sign-in is passwordless
  // (magic link + email code, all three doors) with passkeys for fast repeat
  // sign-in. Google SSO was removed deliberately — not every account we admit is
  // Google-backed (Dartmouth faculty/staff on Microsoft, partners on any
  // provider), and one consistent method across all three doors beats a per-door
  // split. The former `account.accountLinking.trustedProviders: ["google"]` is
  // gone with it: emailOTP/magicLink operate on the User by verified email (no
  // separate provider Account rows to link), and passkeys attach to the already
  // authenticated user, so cross-account linking never enters the passwordless
  // flow. Joining a member's @dali row to their @dartmouth identity, if we ever
  // want it, must be an explicit proof-of-both-inboxes step, never an implicit
  // trust rule here.

  session: {
    // Map to a NEW `AuthSession` table, NOT the bespoke `Session` (sha256-id,
    // grantId→OAuthGrant, absolute expiry) which must keep working through the
    // phased cutover and is dropped only at cleanup. Avoids a model collision.
    modelName: "authSession",
    // 30-day rolling session; updateAge slides the expiry forward at most once
    // per 72 h of use (fewer session-refresh writes; the 30-day max is unchanged).
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 72,
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

    // Resolve the real client IP for BetterAuth's per-IP rate limiting. On Fly,
    // Fly-Client-IP carries a single, un-spoofable client address (Fly's edge
    // sets it). BetterAuth's default (x-forwarded-for) can't be trusted without
    // a configured proxy chain — it rejects any multi-value header — and Fly's
    // XFF has multiple entries, so it was collapsing every request into one
    // shared per-path bucket. Mirrors app/lib/rate-limit.ts's precedence.
    ipAddress: {
      ipAddressHeaders: ["fly-client-ip", "x-forwarded-for"],
    },

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
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, url }, _request) => {
        if (getAppEnv() === "dev") {
          console.info(`[betterauth:magic-link:dev] ${url}`);
        }
        const mail = await renderAuthEmail(signInLinkEmail({ url }));
        const { id: outboundId } = await enqueueOutbound({
          channel: "email",
          purpose: "General",
          // Fresh key each send so a re-request always delivers a new link. A
          // nonce, never the link itself: the retention janitor strips bodyHtml
          // at 24h but not dedupKey, so a credential here would outlive the
          // email by ~retentionMonths (6) in the DB and every backup.
          dedupKey: freshKey("auth.magic_link", email),
          target: email,
          subject: mail.subject,
          bodyHtml: mail.html,
          bodyText: mail.text,
          eventType: "auth.magic_link",
        });
        await drainNow([outboundId]);
      },
    }),
    // emailOTP: a 6-digit sign-in code, offered on /login as the primary
    // passwordless method. Codes survive the laptop→phone handoff that breaks
    // magic links (you type the code back into the tab you started in), which is
    // exactly the returning-user case. disableSignUp keeps it SIGN-IN ONLY — a
    // non-existent address gets a neutral no-op, never a code or a new account;
    // accounts are still created through /signup's magic link + /welcome. Rides
    // the `verification` table (same as magicLink), so no schema change.
    emailOTP({
      otpLength: 6,
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        // Only the sign-in code reaches a surface today; other types are unused.
        if (getAppEnv() === "dev") {
          console.info(`[betterauth:email-otp:dev] ${type} ${otp}`);
        }
        const mail = await renderAuthEmail(
          otpEmail({ otp, purpose: type as OtpPurpose }),
        );
        const { id: outboundId } = await enqueueOutbound({
          channel: "email",
          purpose: "General",
          // Fresh key per code so a resend always delivers. A nonce, never the
          // code itself — see the magic-link key above for why.
          dedupKey: freshKey("auth.email_otp", email),
          target: email,
          subject: mail.subject,
          bodyHtml: mail.html,
          bodyText: mail.text,
          eventType: "auth.email_otp",
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
    // passkey: WebAuthn credentials for fast repeat sign-in (Face ID / Touch ID
    // / security keys), on top of the passwordless-first magic link. rpID is the
    // registrable domain the browser binds credentials to (host only, no scheme
    // or port); origin is the full app URL. Both derive from getApiBaseUrl() so
    // local dev (localhost) and Fly (the real host) each get the right values —
    // a mismatched rpID/origin makes every WebAuthn ceremony fail. Adds the
    // `Passkey` table (see the migration). No cookieCache is enabled, so a
    // deleted passkey stops working immediately.
    passkey({
      rpID: new URL(getApiBaseUrl()).hostname,
      rpName: "DALI OS",
      origin: getApiBaseUrl(),
    }),
    // Deferred plugins (do NOT add these until their schemas are in place):
    //   deviceAuthorization() — Phase 2: desktop Tauri device-code flow
    //   apiKey()           — separate @better-auth/api-key package; Phase 3+
    //   organization()     — partner org membership; later phase
    //   jwt() + mcp()      — Phase 4: @better-auth/mcp MCP provider sessions
  ],

  // Endpoint hooks.
  //
  // `before` canonicalizes the address on the passwordless send endpoints, so
  // an alias (a student's name-form @dartmouth address against a row holding
  // only the NetID-form one) resolves to the account BetterAuth can find. It
  // sits here rather than in the /login action because `api/auth/*` is mounted
  // as a catch-all — authClient, desktop and MCP bypass our routes entirely.
  //
  // `after` records a proven mailbox and audits passkey enrollments/removals,
  // both of which happen inside BetterAuth's own endpoints with no route of
  // ours to hang them off. Each no-ops for every other path.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      await canonicalizeEmailBody(ctx);
    }),
    after: createAuthMiddleware(async (ctx) => {
      await recordProvenEmail(ctx);
      await auditPasskeyMutation(ctx);
    }),
  },

  databaseHooks: {
    user: {
      create: {
        // Populate the app's NOT-NULL firstName/lastName from BetterAuth's
        // single `name` field on every user create. This is NOT type
        // classification: the account type (member / dartmouth / partner) comes
        // from WHICH login door the user chose (the 3-way split is preserved),
        // never from the email domain — auto-classification can't tell a DALI
        // student who is also a partner from a plain student. netID capture
        // likewise happens inside the Dartmouth door's flow
        // (findNetIdByAddress in ~/lib/dartmouth-email-addresses), not here.
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
