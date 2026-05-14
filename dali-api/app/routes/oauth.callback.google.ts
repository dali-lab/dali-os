import type { Route } from "./+types/oauth.callback.google";
import { prisma } from "~/lib/db";
import {
  getOAuthSession,
  getOAuthClient,
  generateAuthorizationCode,
  exchangeGoogleCode,
} from "~/lib/oauth";
import { upsertUserFromGoogle } from "~/lib/user-provisioning";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

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

    const casBase =
      process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";
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

  if (isFirstParty || matchingGrant || !client) {
    const code = await generateAuthorizationCode(session.id, user.id);
    const params = new URLSearchParams({ code, state: session.state });
    return new Response(null, {
      status: 302,
      headers: { Location: `${session.redirectUri}?${params}` },
    });
  }

  // Pre-set userId so the consent screen can render the client + scopes
  // and approve action can issue the code.
  await prisma.oAuthSession.update({
    where: { id: session.id },
    data: { userId: user.id },
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${frontendUrl}/oauth/consent?session_id=${session.id}`,
    },
  });
}
