// DEV-ONLY: log in as any existing user by netId or daliEmail. Sets the
// __dali_sid session cookie via Set-Cookie so it overwrites any existing
// cookie from a real OAuth session.
//
// Usage: GET /dev-login-as?netId=f007al1&redirect=http://localhost:5173/portal

import type { Route } from "./+types/dev-login-as";
import { isDevLoginEnabled } from "~/lib/dev-login";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  if (!isDevLoginEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const netId = url.searchParams.get("netId");
  const daliEmail = url.searchParams.get("daliEmail");
  const defaultRedirect = "http://localhost:3001/";
  const redirect = url.searchParams.get("redirect") ?? defaultRedirect;

  if (!netId && !daliEmail) {
    return new Response("Missing ?netId or ?daliEmail param", { status: 400 });
  }

  const user = daliEmail
    ? await prisma.user.findUnique({ where: { daliEmail } })
    : await prisma.user.findUnique({ where: { netId: netId! } });
  if (!user) {
    return new Response(`No user found for ${daliEmail ? `daliEmail ${daliEmail}` : `netId ${netId}`}`, { status: 404 });
  }

  const email = user.daliEmail ?? user.dartmouthEmail ?? "";
  const type = user.daliEmail ? "member" : "applicant";

  const session = await issueSession({ userId: user.id });

  const userPayload = JSON.stringify({
    id: user.id,
    email,
    firstName: user.firstName,
    lastName: user.lastName,
    type,
  });

  const finalRedirect = url.searchParams.get("redirect")
    ? redirect
    : type === "member" ? "http://localhost:3001/" : "http://localhost:3001/portal";
  const headers = new Headers({ Location: finalRedirect });
  setSessionCookie(headers, session.rawId);
  // __dali_user: web display (NOT HttpOnly so client JS can read it)
  headers.append(
    "Set-Cookie",
    `__dali_user=${encodeURIComponent(userPayload)}; Path=/; Max-Age=86400; SameSite=Lax`,
  );

  return new Response(null, { status: 302, headers });
}
