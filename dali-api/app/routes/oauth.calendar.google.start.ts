// GET /oauth/calendar/google/start
// Initiates the OAuth flow to link an external Google calendar account.
// The callback is /integrations/calendar/google/callback, which is registered
// separately with the Google OAuth client and handles the calendar-link flow
// in isolation from login.

import { requireAuth } from "~/lib/auth";
import { getApiBaseUrl } from "~/lib/app-env";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";
import { randomBytes } from "node:crypto";

export const CAL_STATE_COOKIE = "__dali_cal_oauth_state";

const SCOPES = [
  "openid",
  "email",
  // Full calendar scope: needed for events.insert / events.patch when pushing
  // scheduled meetings and RSVP updates, plus calendarList + freebusy reads.
  "https://www.googleapis.com/auth/calendar",
];

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: "/login" } });
  }
  if (auth.user.type === "applicant") {
    return new Response(null, { status: 302, headers: { Location: "/portal" } });
  }

  const apiBase = getApiBaseUrl();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response("GOOGLE_CLIENT_ID not configured", { status: 500 });
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: `${apiBase}/integrations/calendar/google/callback`,
    scopes: SCOPES,
    state,
    accessType: "offline",
    // `consent` forces a refresh_token even if the user has authorized before.
    prompt: "consent",
  });
  // Append select_account to the prompt: the helper only supports a single
  // prompt value, but Google accepts a space-delimited combination.
  const location = authUrl.replace(
    "prompt=consent",
    "prompt=consent+select_account",
  );

  const stateCookie = `${CAL_STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`;

  return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": stateCookie,
        Location: location,
      },
    });
}
