// Helper invoked from /auth/callback/google when the `state` is prefixed
// with `cal:` (the marker set by /oauth/calendar/google/start). Exchanges the
// authorization code for tokens and upserts a UserCalendarLink for the
// already-authenticated user.
//
// Not exposed as its own route — the file keeps calendar-link logic separate
// from the login callback while sharing Google's registered redirect URI.

import { prisma } from "~/lib/db";
import { buildEncryptedTokens } from "~/lib/google-calendar";
import { CAL_STATE_COOKIE, CAL_STATE_PREFIX } from "~/routes/oauth.calendar.google.start";

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k) out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

function clearCookieHeader() {
  return `${CAL_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function redirectToCalendar(qs: string) {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": clearCookieHeader(),
      Location: `/calendar?${qs}`,
    },
  });
}

/**
 * Returns a Response that redirects back to /calendar — never throws.
 */
export async function handleCalendarLinkCallback({
  request,
  userId,
  code,
  state,
}: {
  request: Request;
  userId: string;
  code: string;
  state: string;
}): Promise<Response> {
  if (!state.startsWith(CAL_STATE_PREFIX)) {
    return redirectToCalendar("calendar_link_error=bad_state");
  }
  const nonce = state.slice(CAL_STATE_PREFIX.length);
  const cookies = parseCookies(request);
  if (cookies[CAL_STATE_COOKIE] !== nonce || !nonce) {
    return redirectToCalendar("calendar_link_error=state_mismatch");
  }

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      // Must match the redirect_uri we sent in /start (== the login callback URI).
      redirect_uri: `${apiBase}/auth/callback/google`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return redirectToCalendar("calendar_link_error=token_exchange_failed");
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!tokens.refresh_token) {
    return redirectToCalendar("calendar_link_error=no_refresh_token");
  }

  const externalEmail = await resolveExternalEmail(tokens.id_token, tokens.access_token);
  if (!externalEmail) {
    return redirectToCalendar("calendar_link_error=no_email");
  }

  const cipher = buildEncryptedTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresInSec: tokens.expires_in ?? null,
  });

  await prisma.userCalendarLink.upsert({
    where: {
      userId_provider_externalEmail: { userId, provider: "Google", externalEmail },
    },
    create: {
      userId,
      provider: "Google",
      externalEmail,
      displayName: externalEmail,
      oauthTokens: cipher,
      primary: false,
      enabled: true,
      subCalendarIds: [],
    },
    update: {
      oauthTokens: cipher,
      enabled: true,
      syncError: null,
    },
  });

  return redirectToCalendar("calendar_linked=1");
}

async function resolveExternalEmail(idToken: string | undefined, accessToken: string): Promise<string | null> {
  if (idToken) {
    const payload = decodeIdTokenPayload(idToken);
    if (payload && typeof payload.email === "string") return payload.email;
  }
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

function decodeIdTokenPayload(idToken: string): { email?: string } | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}
