import type { Route } from "./+types/oauth.callback.google";
import { prisma } from "~/lib/db";
import {
  getOAuthSession,
  generateAuthorizationCode,
  exchangeGoogleCode,
  OAuthError,
} from "~/lib/oauth";

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

  // enforce email domain for DALI members
  // note: technically done by Google because of internal project settings, but enforced here also
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

  // upsert user (and persist Google tokens for Calendar API access)
  const tokenExpiresAt = googleUser.expiresIn
    ? new Date(Date.now() + googleUser.expiresIn * 1000)
    : null;

  const user = await prisma.user.upsert({
    where: { daliEmail: googleUser.email },
    update: {
      ...(googleUser.accessToken ? { googleAccessToken: googleUser.accessToken } : {}),
      ...(googleUser.refreshToken ? { googleRefreshToken: googleUser.refreshToken } : {}),
      ...(tokenExpiresAt ? { googleTokenExpiresAt: tokenExpiresAt } : {}),
    },
    create: {
      daliEmail: googleUser.email,
      firstName: googleUser.firstName,
      lastName: googleUser.lastName,
      googleAccessToken: googleUser.accessToken,
      googleRefreshToken: googleUser.refreshToken,
      googleTokenExpiresAt: tokenExpiresAt,
    },
  });

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

  // issue authorization code and redirect to client
  const code = await generateAuthorizationCode(session.id, user.id);
  const params = new URLSearchParams({ code, state: session.state });
  return new Response(null, {
    status: 302,
    headers: { Location: `${session.redirectUri}?${params}` },
  });
}
