// DEV-ONLY: log in as any existing user by email, daliEmail, or netId.
// Usage: GET /dev-login-as?email=foo@example.com&redirect=http://localhost:5173/portal
//        GET /dev-login-as?daliEmail=foo@dali.dartmouth.edu
//        GET /dev-login-as?netId=f007al1

import type { Route } from "./+types/dev-login-as";
import { isDevLoginEnabled } from "~/lib/dev-login";
import { prisma } from "~/lib/db";
import { randomBytes } from "node:crypto";

export async function loader({ request }: Route.LoaderArgs) {
  if (!isDevLoginEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const daliEmail = url.searchParams.get("daliEmail");
  const netId = url.searchParams.get("netId");
  const redirectTo = url.searchParams.get("redirect") ?? "http://localhost:3001/portal";

  if (!email && !daliEmail && !netId) {
    return new Response("Missing ?email, ?daliEmail, or ?netId param", { status: 400 });
  }

  const user = email
    ? await prisma.user.findUnique({ where: { email } })
    : daliEmail
      ? await prisma.user.findUnique({ where: { daliEmail } })
      : await prisma.user.findUnique({ where: { netId: netId! } });

  if (!user) {
    return new Response(`No user found`, { status: 404 });
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    },
  });

  const isProduction = process.env.NODE_ENV === "production";
  const cookieParts = [
    `better-auth.session_token=${token}`,
    "Path=/",
    "Max-Age=604800",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction) cookieParts.push("Secure");

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookieParts.join("; "),
      Location: redirectTo,
    },
  });
}
