// GET /oauth/calendar/google/start
// Initiates the OAuth flow to link an external Google calendar account.
// The callback is /integrations/calendar/google/callback, which is registered
// separately with the Google OAuth client and handles the calendar-link flow
// in isolation from login.

import { requireAuth } from "~/lib/auth";
import { randomBytes } from "node:crypto";

export const CAL_STATE_COOKIE = "__dali_cal_oauth_state";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return new Response(null, { status: 302, headers: { Location: "/login" } });
  }
  if (auth.user.type === "applicant") {
    return new Response(null, { status: 302, headers: { Location: "/portal" } });
  }

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response("GOOGLE_CLIENT_ID not configured", { status: 500 });
  }

  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${apiBase}/integrations/calendar/google/callback`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // `consent` forces a refresh_token even if the user has authorized before.
    prompt: "consent select_account",
    state,
  });

  const stateCookie = `${CAL_STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`;

  return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": stateCookie,
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      },
    });
}
