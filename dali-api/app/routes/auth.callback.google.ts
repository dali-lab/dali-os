import type { Route } from "./+types/auth.callback.google";
import { exchangeGoogleCode } from "~/lib/oauth";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import { upsertUserFromGoogle } from "~/lib/user-provisioning";
import { getApiBaseUrl, getCasBaseUrl } from "~/lib/app-env";

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

  // Returning-partner convenience sign-in (spec: Google is repeat sign-in
  // only; magic link is the sole account-creation path). Branches on DB
  // state — a pre-existing PartnerUser matched by the Google-verified email —
  // not on any strippable cookie, so it cannot widen access: an email with
  // no PartnerUser row falls through to the member-domain check unchanged.
  const partnerCandidate = await prisma.user.findUnique({
    where: { personalEmail: googleUser.email.toLowerCase() },
    select: { id: true, partnerUser: { select: { id: true } } },
  });
  if (partnerCandidate?.partnerUser) {
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
    await prisma.partnerUser.update({
      where: { id: partnerCandidate.partnerUser.id },
      data: { authProvider: "Google" },
    });
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    setSessionCookie(headers, session.rawId);
    headers.set("Location", "/partner");
    return new Response(null, { status: 302, headers });
  }

  // The /login Member button and the partner login's Google button both use
  // this callback; with the partner branch handled above on DB state,
  // @dali.dartmouth.edu is the only valid outcome here. Enforce
  // unconditionally — we no longer rely on the __dali_account_type cookie
  // (which could be stripped) to gate the check. Dartmouth-student branches
  // that used to live inline below are gone for the same reason: unreachable
  // from any production route. They live on (for now) in the OAuth-provider
  // callback `/oauth/callback/google`, which gates on a different signal
  // (`OAuthSession.accountType`).
  if (!googleUser.email.endsWith("@dali.dartmouth.edu")) {
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

  // Always-enforce above means we only reach this with an @dali.dartmouth.edu
  // email, so the helper's member branch fires and creates a DALIMember if
  // missing. Dartmouth-student and partner branches in the helper are
  // unreachable through this route — they live on for the OAuth-provider
  // callback `/oauth/callback/google` which gates on a different signal.
  const { user } = await upsertUserFromGoogle(googleUser);

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
  // oauth.callback.google.ts.
  if (!user.netId) {
    const casBase = getCasBaseUrl();
    const serviceUrl = `${apiBase}/auth/callback/cas?link=1`;
    headers.set(
      "Location",
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
    );
    return new Response(null, { status: 302, headers });
  }

  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
}
