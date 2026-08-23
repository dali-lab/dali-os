import type { Route } from "./+types/auth.callback.google";
import { exchangeGoogleCode } from "~/lib/oauth";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import { upsertUserFromGoogle } from "~/lib/user-provisioning";
import { classifyPartnerEmail } from "~/partners/lib/magic-link.server";
import { getApiBaseUrl, getCasBaseUrl } from "~/lib/app-env";
import { syncAndRecomputeMembershipStatus } from "~/lib/membership-status";
import { consumeLoginNext } from "~/lib/login-next";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  const entries: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k) entries[k.trim()] = rest.join("=").trim();
  }
  return entries;
}

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const apiBase = getApiBaseUrl();

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError || !code || !state) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "missing_code" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=google_auth_failed" },
    });
  }

  // CSRF validation
  const cookies = parseCookies(request);
  const savedState = cookies[OAUTH_STATE_COOKIE];
  const clearStateCookie = `${OAUTH_STATE_COOKIE}=; Path=/auth/callback/google; Max-Age=0; HttpOnly; SameSite=Lax`;

  if (!savedState || savedState !== state) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "state_mismatch" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=server_error",
      },
    });
  }

  // Exchange Google code for user info
  let googleUser;
  try {
    googleUser = await exchangeGoogleCode(code, `${apiBase}/auth/callback/google`);
  } catch {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "code_exchange_failed" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=server_error",
      },
    });
  }

  // Returning-partner sign-in. Branches on DB state — a pre-existing
  // PartnerContact matched by the Google-verified email — not on any strippable
  // cookie, so it cannot widen access: an email with no PartnerContact row falls
  // through to the member-domain check / partner-signup branch below.
  const partnerCandidate = await prisma.user.findUnique({
    where: { personalEmail: googleUser.email.toLowerCase() },
    select: { id: true, partnerContact: { select: { id: true } } },
  });
  if (partnerCandidate?.partnerContact) {
    const session = await issueSession({
      userId: partnerCandidate.id,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip: getClientIp(request),
    });
    await logAuditEvent({
      action: "login.success",
      userId: partnerCandidate.id,
      metadata: {
        provider: "google",
        authType: "partner",
        email: googleUser.email,
      },
      request,
    });
    await prisma.partnerContact.update({
      where: { id: partnerCandidate.partnerContact.id },
      data: { authProvider: "Google" },
    });
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    setSessionCookie(headers, session.rawId);
    headers.set("Location", "/partner");
    return new Response(null, { status: 302, headers });
  }

  // The /login Member button and the partner login's Google button both use
  // this callback. A non-lab email with no PartnerUser row is a first-time
  // partner: enter the same onboarding the magic link uses (Google verified
  // the email — exchangeGoogleCode rejects unverified claims — so this is
  // equivalent proof of ownership to a delivered link). classifyPartnerEmail
  // keeps member/Dartmouth identities on their own sign-in paths, exactly as
  // the magic-link issuer does.
  if (!googleUser.email.endsWith("@dali.dartmouth.edu")) {
    const email = googleUser.email.toLowerCase();
    const identity = await classifyPartnerEmail(email);
    if (identity.kind === "member-conflict") {
      await logAuditEvent({
        action: "login.failure",
        metadata: {
          provider: "google",
          reason: "domain_denied",
          email: googleUser.email,
        },
        request,
      });
      return new Response(null, {
        status: 302,
        headers: {
          "Set-Cookie": clearStateCookie,
          Location: "/login?error=access_denied",
        },
      });
    }

    // "existing" = a partner-in-progress User (magic link requested but
    // onboarding unfinished, or removed from an org). "new" mirrors the
    // magic-link issuer's eager User creation — with Google's verified name
    // as a bonus, so onboarding arrives prefilled.
    const userId =
      identity.kind === "existing"
        ? identity.userId
        : (
            await prisma.user.create({
              data: {
                personalEmail: email,
                firstName: googleUser.firstName,
                lastName: googleUser.lastName,
              },
              select: { id: true },
            })
          ).id;

    // Ensure the account-first PartnerContact exists and record that they
    // authenticated via Google. Link an existing contact (e.g. one Core created
    // when it logged this person's inquiry from an email) by email rather than
    // create a duplicate — PartnerContact.email is unique. Inlined here (not via
    // the .server guard helper) because this is a resource route.
    const existingContact = await prisma.partnerContact.findFirst({
      where: { OR: [{ userId }, { email }] },
      select: { id: true, userId: true },
    });
    if (existingContact) {
      await prisma.partnerContact.update({
        where: { id: existingContact.id },
        data: {
          authProvider: "Google",
          ...(existingContact.userId ? {} : { userId }),
        },
      });
    } else {
      await prisma.partnerContact.create({
        data: {
          userId,
          email,
          name: `${googleUser.firstName} ${googleUser.lastName}`.trim() || email,
          authProvider: "Google",
        },
      });
    }

    const session = await issueSession({
      userId,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip: getClientIp(request),
    });
    await logAuditEvent({
      action: "login.success",
      userId,
      metadata: {
        provider: "google",
        authType: "partner",
        signup: identity.kind === "new",
        email: googleUser.email,
      },
      request,
    });
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    setSessionCookie(headers, session.rawId);
    // Google gave us the name, so onboarding is optional — go straight to the
    // portal (consistent with the magic-link verify flow).
    headers.set("Location", "/partner");
    return new Response(null, { status: 302, headers });
  }

  // Always-enforce above means we only reach this with an @dali.dartmouth.edu
  // email, so the helper's member branch fires and creates a DALIMember if
  // missing. Dartmouth-student and partner branches in the helper are
  // unreachable through this route — they live on for the OAuth-provider
  // callback `/oauth/callback/google` which gates on a different signal.
  const { user } = await upsertUserFromGoogle(googleUser);

  // Fire-and-forget membership-status sync (throttled ≤1/day). Members mostly
  // sign in with Google; without a netId the Dartmouth refresh no-ops and the
  // recompute still runs from graduatedAt + classYear. Never blocks the login.
  void syncAndRecomputeMembershipStatus(user.id);

  const session = await issueSession({
    userId: user.id,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });
  await logAuditEvent({
    action: "login.success",
    userId: user.id,
    metadata: {
      provider: "google",
      authType: "member",
      email: googleUser.email,
    },
    request,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie);
  setSessionCookie(headers, session.rawId);

  // First Google login for a brand-new member (or an accepted applicant whose
  // CAS-side User row hasn't been linked yet) → chain through CAS so we can
  // merge with any existing applicant record. The session cookie identifies
  // which User to attach the netId to on return; linkCasToGoogleUser handles
  // the merge / no-op / attach cases. Mirrors the MCP-provider flow in
  // oauth.callback.google.ts. Leave __dali_login_next for the final CAS hop.
  if (!user.netId) {
    const casBase = getCasBaseUrl();
    const serviceUrl = `${apiBase}/auth/callback/cas?link=1`;
    headers.set(
      "Location",
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
    );
    return new Response(null, { status: 302, headers });
  }

  const next = consumeLoginNext(request, headers);
  headers.set("Location", next ?? "/");
  return new Response(null, { status: 302, headers });
}
