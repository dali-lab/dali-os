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

// One granular scope per Calendar API surface the app actually calls:
//   calendar.events        events list/insert/patch/delete (busy, meeting push, RSVP)
//   calendar.calendars     calendars insert/patch/delete (the named DALI calendar)
//   calendar.calendarlist  calendarList list/insert/patch (sub-calendars, colours)
// Deliberately NOT the umbrella `auth/calendar`, which also grants the ACL
// surface nothing here touches, so a leaked token could reshare a member's
// calendar to an outsider.
// Exported so the callback can confirm Google actually *granted* all of them:
// a partial grant (granular consent, or a Workspace policy that blocks one)
// still completes the flow, so we have to check the response.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.calendarlist",
];

const SCOPES = ["openid", "email", ...GOOGLE_CALENDAR_SCOPES];

// The pre-reduction scope. Google accumulates scopes per OAuth client, so a
// member who linked before this change can have the umbrella grant echoed back
// on a relink in place of the three granular scopes. It is a superset of all of
// them, so it satisfies the requirement — refusing it would lock existing
// members out of reconnecting.
const GOOGLE_CALENDAR_UMBRELLA_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Whether a space-delimited granted-scope string covers everything the app calls. */
export function grantCoversCalendarScopes(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(" ").filter(Boolean));
  if (granted.has(GOOGLE_CALENDAR_UMBRELLA_SCOPE)) return true;
  return GOOGLE_CALENDAR_SCOPES.every((scope) => granted.has(scope));
}

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
