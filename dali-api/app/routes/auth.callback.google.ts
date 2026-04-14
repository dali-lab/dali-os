import type { Route } from "./+types/auth.callback.google";
import { prisma } from "~/lib/db";
import { exchangeGoogleCode, issueTokens } from "~/lib/oauth";
import { setTokenCookies } from "~/lib/cookies";

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
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError || !code || !state) {
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
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=server_error",
      },
    });
  }

  // Enforce DALI domain
  if (!googleUser.email.endsWith("@dali.dartmouth.edu")) {
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=access_denied",
      },
    });
  }

  // Upsert user
  const user = await prisma.user.upsert({
    where: { daliEmail: googleUser.email },
    update: { firstName: googleUser.firstName, lastName: googleUser.lastName },
    create: {
      daliEmail: googleUser.email,
      firstName: googleUser.firstName,
      lastName: googleUser.lastName,
    },
  });

  // Issue tokens and set cookies
  const tokens = await issueTokens(user.id, "member");
  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie);
  setTokenCookies(headers, tokens.access_token, tokens.refresh_token);
  headers.set("Location", "/admin");

  return new Response(null, { status: 302, headers });
}
