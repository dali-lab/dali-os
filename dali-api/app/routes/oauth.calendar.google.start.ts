// GET /oauth/calendar/google/start
// Initiates the OAuth flow to link an external Google calendar account.
// Reuses the existing /auth/callback/google redirect URI (already registered
// with the Google OAuth client) and disambiguates calendar-link flow vs. login
// flow via a `cal:` state prefix. The login callback dispatches on that prefix
// to handleCalendarLinkCallback, which writes a UserCalendarLink for the
// already-authenticated user.

import { requireAuth, withAuth } from "~/lib/auth";
import { randomBytes } from "node:crypto";

export const CAL_STATE_COOKIE = "__dali_cal_oauth_state";
export const CAL_STATE_PREFIX = "cal:";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withAuth(auth, new Response(null, { status: 302, headers: { Location: "/login" } }));
  }
  if (auth.user.type === "applicant") {
    return withAuth(auth, new Response(null, { status: 302, headers: { Location: "/portal" } }));
  }

  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return withAuth(auth, new Response("GOOGLE_CLIENT_ID not configured", { status: 500 }));
  }

  const nonce = randomBytes(16).toString("hex");
  const state = `${CAL_STATE_PREFIX}${nonce}`;
  const params = new URLSearchParams({
    client_id: clientId,
    // Reuse the registered login redirect; the callback dispatches on `cal:` state.
    redirect_uri: `${apiBase}/auth/callback/google`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // `consent` forces a refresh_token even if the user has authorized before.
    prompt: "consent select_account",
    state,
  });

  // Use Path=/ so the cookie is sent on /auth/callback/google too.
  const stateCookie = `${CAL_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`;

  return withAuth(
    auth,
    new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": stateCookie,
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      },
    }),
  );
}
