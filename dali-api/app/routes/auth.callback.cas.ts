import type { Route } from "./+types/auth.callback.cas";
import { prisma } from "~/lib/db";
import { validateCasTicket } from "~/lib/auth";
import { issueTokens } from "~/lib/oauth";
import { setTokenCookies } from "~/lib/cookies";
import { linkCasUserToMember } from "~/lib/linking";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const ticket = url.searchParams.get("ticket");

  if (!ticket) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=cas_auth_failed" },
    });
  }

  // Validate CAS ticket
  let casUser;
  try {
    casUser = await validateCasTicket(ticket, `${apiBase}/auth/callback/cas`);
  } catch {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=cas_auth_failed" },
    });
  }

  // Upsert user with CAS-derived info
  const dartmouthEmail = `${casUser.netId}@dartmouth.edu`;
  const user = await prisma.user.upsert({
    where: { netId: casUser.netId },
    update: {
      firstName: casUser.firstName,
      lastName: casUser.lastName,
      dartmouthEmail,
    },
    create: {
      netId: casUser.netId,
      firstName: casUser.firstName,
      lastName: casUser.lastName,
      dartmouthEmail,
    },
  });

  // If this CAS user is a DALI member, merge accounts if needed and redirect to /reviewer
  const member = await linkCasUserToMember(user.id, dartmouthEmail);
  if (member) {
    const tokens = await issueTokens(user.id, "member");
    const headers = new Headers();
    setTokenCookies(headers, tokens.access_token, tokens.refresh_token);
    headers.set("Location", "/reviewer");
    return new Response(null, { status: 302, headers });
  }

  // Issue tokens and set cookies
  const tokens = await issueTokens(user.id, "dartmouth");
  const headers = new Headers();
  setTokenCookies(headers, tokens.access_token, tokens.refresh_token);
  headers.set("Location", "/portal");

  return new Response(null, { status: 302, headers });
}
