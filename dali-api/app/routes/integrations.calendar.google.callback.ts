// GET /integrations/calendar/google/callback
// Dedicated callback for the calendar-link flow initiated by
// /oauth/calendar/google/start. Exchanges Google's authorization code for
// tokens and upserts a UserCalendarLink for the already-authenticated user.
//
// This is separate from /auth/callback/google (login) so the two flows don't
// have to share a redirect URI or disambiguate via a state-prefix hack.
//
// The Email tab's mailbox connect also returns here (its redirect URI is this
// one, already registered with Google); it's recognised by its own state
// cookie and finished in ~/email/lib/mail-connect.server.

import type { Route } from "./+types/integrations.calendar.google.callback";
import { prisma } from "~/lib/db";
import { buildEncryptedTokens } from "~/lib/google-calendar";
import { requireAuth } from "~/lib/auth";
import { CAL_STATE_COOKIE, GOOGLE_CALENDAR_SCOPE } from "~/routes/oauth.calendar.google.start";
import { getApiBaseUrl } from "~/lib/app-env";
import { exchangeGoogleCode, GoogleOAuthError, resolveGoogleEmail } from "~/lib/google-oauth";
import { completeMailConnect, isMailConnectCallback } from "~/email/lib/mail-connect.server";

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

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  if (isMailConnectCallback(request)) return completeMailConnect(request);

  const auth = await requireAuth(request);
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: "/login" } });
  }
  if (auth.user.type === "applicant") {
    return new Response(null, { status: 302, headers: { Location: "/portal" } });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError || !code || !state) {
    return redirectToCalendar("calendar_link_error=auth_failed");
  }

  const cookies = parseCookies(request);
  if (!cookies[CAL_STATE_COOKIE] || cookies[CAL_STATE_COOKIE] !== state) {
    return redirectToCalendar("calendar_link_error=state_mismatch");
  }

  const apiBase = getApiBaseUrl();
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  let tokens;
  try {
    tokens = await exchangeGoogleCode({
      code,
      // Must match the redirect_uri sent by /oauth/calendar/google/start.
      redirectUri: `${apiBase}/integrations/calendar/google/callback`,
      clientId,
      clientSecret,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      return redirectToCalendar("calendar_link_error=token_exchange_failed");
    }
    throw err;
  }
  // Google can finish consent while granting FEWER scopes than we asked for
  // (granular consent lets the user untick calendar; a Workspace admin policy
  // can strip the sensitive scope outright). The flow still returns valid
  // tokens, so without this guard we'd persist a link that 403s
  // ("insufficient authentication scopes") on every sync. Refuse it up front
  // with a message the Calendars panel can act on, and don't clobber whatever
  // (possibly working) link already exists for this account.
  if (tokens.scope && !tokens.scope.split(" ").includes(GOOGLE_CALENDAR_SCOPE)) {
    return redirectToCalendar("calendar_link_error=calendar_scope_denied");
  }
  if (!tokens.refresh_token) {
    return redirectToCalendar("calendar_link_error=no_refresh_token");
  }

  const externalEmail = await resolveGoogleEmail(tokens.id_token, tokens.access_token);
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
      userId_provider_externalEmail: {
        userId: auth.user.sub,
        provider: "Google",
        externalEmail,
      },
    },
    create: {
      userId: auth.user.sub,
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
