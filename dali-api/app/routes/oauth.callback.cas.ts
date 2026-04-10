import type { Route } from "./+types/oauth.callback.cas";
import { prisma } from "~/lib/db";
import { validateCasTicket } from "~/lib/auth";
import { getOAuthSession, generateAuthorizationCode } from "~/lib/oauth";
import { linkCasToGoogleUser } from "~/lib/linking";

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

  // validate CAS ticket
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

  const { netId, firstName, lastName } = casResult;
  let finalUser;

  if (session.linkUserId) {
    // chained auth: link the Google user to this CAS identity
    try {
      finalUser = await linkCasToGoogleUser(session.linkUserId, netId);
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
  } else {
    // standalone CAS login
    finalUser = await prisma.user.upsert({
      where: { netId },
      update: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
      },
      create: { netId, firstName, lastName },
    });
  }

  const code = await generateAuthorizationCode(session.id, finalUser.id);
  const params = new URLSearchParams({ code, state: session.state });
  return new Response(null, {
    status: 302,
    headers: { Location: `${session.redirectUri}?${params}` },
  });
}
