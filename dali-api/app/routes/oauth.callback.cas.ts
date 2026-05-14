import type { Route } from "./+types/oauth.callback.cas";
import { validateCasTicket } from "~/lib/auth";
import {
  getOAuthSession,
  getOAuthClient,
  generateAuthorizationCode,
} from "~/lib/oauth";
import { upsertUserFromCas } from "~/lib/user-provisioning";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const ticket = url.searchParams.get("ticket");
  const sessionId = url.searchParams.get("session_id");

  if (!ticket || !sessionId) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/login?error=missing_params` },
    });
  }

  const session = await getOAuthSession(sessionId);
  if (!session || session.expiresAt < new Date() || session.exchanged) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${frontendUrl}/login?error=session_expired` },
    });
  }

  const serviceUrl = `${apiBase}/oauth/callback/cas?session_id=${sessionId}`;
  let casResult;
  try {
    casResult = await validateCasTicket(ticket, serviceUrl);
  } catch {
    const params = new URLSearchParams({
      error: "access_denied",
      error_description: "CAS validation failed",
      state: session.state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `${session.redirectUri}?${params}` },
    });
  }

  let finalUser;
  try {
    const result = await upsertUserFromCas(casResult, {
      linkUserId: session.linkUserId ?? undefined,
    });
    finalUser = result.user;
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

  // Consent-vs-direct branching, matching the Google callback. First-party
  // clients skip consent; everyone else hits the consent screen unless an
  // existing OAuthGrant already covers the requested scopes.
  const client = session.clientId ? await getOAuthClient(session.clientId) : null;
  const requestedScopes = session.scopes ?? [];
  const isFirstParty = client?.isFirstParty ?? false;

  let matchingGrant = false;
  if (client && !isFirstParty) {
    const grant = await prisma.oAuthGrant.findUnique({
      where: {
        userId_clientId: { userId: finalUser.id, clientId: client.clientId },
      },
    });
    if (grant && !grant.revokedAt) {
      matchingGrant = requestedScopes.every((s) => grant.scopes.includes(s));
    }
  }

  // Issue a first-party cookie session so the consent screen (and any
  // subsequent first-party page load) can verify the user is signed in.
  // This is the same cookie shape `/auth/callback/cas` issues; the MCP
  // grant-bound session is separate and gets minted at /oauth/token.
  const cookieSession = await issueSession({
    userId: finalUser.id,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });

  if (isFirstParty || matchingGrant || !client) {
    const code = await generateAuthorizationCode(session.id, finalUser.id);
    const params = new URLSearchParams({ code, state: session.state });
    const headers = new Headers();
    setSessionCookie(headers, cookieSession.rawId);
    headers.set("Location", `${session.redirectUri}?${params}`);
    return new Response(null, { status: 302, headers });
  }

  await prisma.oAuthSession.update({
    where: { id: session.id },
    data: { userId: finalUser.id },
  });
  const headers = new Headers();
  setSessionCookie(headers, cookieSession.rawId);
  headers.set("Location", `/oauth/consent?session_id=${session.id}`);
  return new Response(null, { status: 302, headers });
}
