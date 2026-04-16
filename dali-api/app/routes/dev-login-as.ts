// DEV-ONLY: log in as any existing user by netId. Sets both __dali_at (api JWT)
// and __dali_user (web display) cookies via Set-Cookie headers so it overwrites
// any existing HttpOnly cookies from real OAuth sessions.
//
// Usage: GET /dev-login-as?netId=f007al1&redirect=http://localhost:5173/portal

import type { Route } from "./+types/dev-login-as";
import { signAccessToken } from "~/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const netId = url.searchParams.get("netId");
  const daliEmail = url.searchParams.get("daliEmail");
  const redirect = url.searchParams.get("redirect") ?? "http://localhost:3001/";

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

  const token = await signAccessToken({
    sub: user.id,
    email,
    type,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const userPayload = JSON.stringify({
    id: user.id,
    email,
    firstName: user.firstName,
    lastName: user.lastName,
    type,
  });

  const headers = new Headers({ Location: redirect });
  // __dali_at: api auth (HttpOnly so JS can't read; server-set overwrites any existing)
  headers.append(
    "Set-Cookie",
    `__dali_at=${token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`,
  );
  // __dali_user: web display (NOT HttpOnly so dali-web JS can read it)
  headers.append(
    "Set-Cookie",
    `__dali_user=${encodeURIComponent(userPayload)}; Path=/; Max-Age=86400; SameSite=Lax`,
  );

  return new Response(null, { status: 302, headers });
}
