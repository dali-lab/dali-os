import type { Route } from "./+types/oauth.callback.google";
import { prisma } from "~/lib/db";
import {
  getOAuthSession,
  getOAuthClient,
  generateAuthorizationCode,
  exchangeGoogleCode,
} from "~/lib/oauth";
import { upsertUserFromGoogle } from "~/lib/user-provisioning";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { syncAndRecomputeMembershipStatus } from "~/lib/membership-status";
import { getApiBaseUrl, getCasBaseUrl, getFrontendUrl } from "~/lib/app-env";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const frontendUrl = getFrontendUrl();
  const apiBase = getApiBaseUrl();

  const googleCode = url.searchParams.get("code");
  const sessionId = url.searchParams.get("state"); // passed session.id as Google's state
  const googleError = url.searchParams.get("error");

  if (googleError || !googleCode || !sessionId) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/login?error=google_auth_failed` },
    });
  }

  const session = await getOAuthSession(sessionId);
  if (!session || session.expiresAt < new Date() || session.exchanged) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/login?error=session_expired` },
    });
  }

  // exchange Google's code for user info
  let googleUser;
  try {
    googleUser = await exchangeGoogleCode(
      googleCode,
      `${apiBase}/oauth/callback/google`,
    );
  } catch {
    const params = new URLSearchParams({
      error: "server_error",
      state: session.state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `${session.redirectUri}?${params}` },
    });
  }

  // Enforce client policy. accountType=member requires @dali.dartmouth.edu.
  if (
    session.accountType === "member" &&
    !googleUser.email.endsWith("@dali.dartmouth.edu")
  ) {
    const params = new URLSearchParams({
      error: "access_denied",
      error_description: "Must use a @dali.dartmouth.edu email",
      state: session.state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `${session.redirectUri}?${params}` },
    });
  }

  const { user } = await upsertUserFromGoogle(googleUser);

  // Fire-and-forget membership-status sync (throttled ≤1/day). Never blocks.
  void syncAndRecomputeMembershipStatus(user.id);

  // Resolve the OAuthClient policy. requireMembership is a belt-and-suspenders
  // check after the upsert (which already creates a DALIMember marker).
  const client = session.clientId ? await getOAuthClient(session.clientId) : null;
  if (client?.requireMembership) {
    const member = await prisma.dALIMember.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!member) {
      const params = new URLSearchParams({
        error: "access_denied",
        error_description: "not_a_member",
        state: session.state,
      });
      return new Response(null, {
        status: 302,
        headers: { Location: `${session.redirectUri}?${params}` },
      });
    }
  }

  // if member needs CAS link → chain to CAS
  if (session.accountType === "member" && !user.netId) {
    await prisma.oAuthSession.update({
      where: { id: session.id },
      data: { linkUserId: user.id },
    });

    const casBase = getCasBaseUrl();
    const serviceUrl = `${apiBase}/oauth/callback/cas?session_id=${session.id}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      },
    });
  }

  // Consent-vs-direct branching. First-party clients skip consent; for
  // everyone else we look for a non-revoked OAuthGrant whose scopes cover
  // the requested scopes — match → straight to code, miss → consent screen.
  const requestedScopes = session.scopes ?? [];
  const isFirstParty = client?.isFirstParty ?? false;

  let matchingGrant = false;
  if (client && !isFirstParty) {
    const grant = await prisma.oAuthGrant.findUnique({
      where: {
        userId_clientId: { userId: user.id, clientId: client.clientId },
      },
    });
    if (grant && !grant.revokedAt) {
      matchingGrant = requestedScopes.every((s) => grant.scopes.includes(s));
    }
  }

  // Issue a first-party cookie session so the consent screen (and any
  // subsequent first-party page load) can verify the user is signed in.
  // This is the same cookie shape `/auth/callback/google` issues; the MCP
  // grant-bound session is separate and gets minted at /oauth/token.
  const cookieSession = await issueSession({
    userId: user.id,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });

  if (isFirstParty || matchingGrant || !client) {
    const code = await generateAuthorizationCode(session.id, user.id);
    const params = new URLSearchParams({ code, state: session.state });
    const headers = new Headers();
    setSessionCookie(headers, cookieSession.rawId);
    headers.set("Location", `${session.redirectUri}?${params}`);
    return new Response(null, { status: 302, headers });
  }

  // Pre-set userId so the consent screen can render the client + scopes
  // and approve action can issue the code.
  await prisma.oAuthSession.update({
    where: { id: session.id },
    data: { userId: user.id },
  });
  const headers = new Headers();
  setSessionCookie(headers, cookieSession.rawId);
  headers.set("Location", `/oauth/consent?session_id=${session.id}`);
  return new Response(null, { status: 302, headers });
}
