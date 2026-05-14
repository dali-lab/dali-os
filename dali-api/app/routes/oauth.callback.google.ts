import type { Route } from "./+types/oauth.callback.google";
import { prisma } from "~/lib/db";
import {
  getOAuthSession,
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

  // Enforce the client's requiredAccountType. Today the only check is
  // "member must use @dali.dartmouth.edu". When the OAuthClient registry
  // lands (see dali-os-mcp.md), this becomes a generic check against
  // `client.requiredAccountType` and `client.requireMembership`.
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
