// GET /oauth/mail/google/start?target=project:<id>|shared:<accountId>
// Starts the Google sign-in that connects a mailbox to the Email tab. Google
// returns through the calendar-link callback (already registered on the OAuth
// client), which hands the request to ~/email/lib/mail-connect.server.

import type { Route } from "./+types/oauth.mail.google.start";
import { randomBytes } from "node:crypto";
import { requireAuth } from "~/lib/auth";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { GMAIL_MODIFY_SCOPE } from "~/email/lib/gmail-mailbox.server";
import { MAIL_STATE_COOKIE, mailConnectRedirectUri } from "~/email/lib/mail-connect.server";
import {
  expectedConnectAddress,
  parseConnectTarget,
  serializeConnectTarget,
} from "~/email/lib/access.server";


export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const userId = auth.user.sub;

  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("email", userId, roles, request))) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }

  const target = parseConnectTarget(new URL(request.url).searchParams.get("target"));
  if (!target) return new Response("Unknown account", { status: 400 });
  const expected = await expectedConnectAddress(userId, target, request);
  if (expected === undefined) return new Response("Forbidden", { status: 403 });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return new Response("GOOGLE_CLIENT_ID not configured", { status: 500 });

  const state = randomBytes(16).toString("hex");
  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri: mailConnectRedirectUri(),
    scopes: ["openid", "email", GMAIL_MODIFY_SCOPE],
    state,
    accessType: "offline",
    prompt: "consent",
    loginHint: expected ?? undefined,
  });
  const location = authUrl.replace("prompt=consent", "prompt=consent+select_account");
  const cookieValue = `${state}.${Buffer.from(serializeConnectTarget(target)).toString("base64url")}`;

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": `${MAIL_STATE_COOKIE}=${cookieValue}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`,
      Location: location,
    },
  });
}
