// DEV-ONLY: log in as any existing user by email.
// Usage: GET /dev-login-as?email=foo@example.com&redirect=http://localhost:5173/portal

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
  const redirectTo = url.searchParams.get("redirect") ?? "http://localhost:3001/portal";

  if (!email) {
    return new Response("Missing ?email param", { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return new Response(`No user found for email ${email}`, { status: 404 });
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
