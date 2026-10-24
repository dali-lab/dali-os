import { clearSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";

// Signs `userId` in on the response carrying `headers`.
export async function startLoginSession(
  headers: Headers,
  request: Request,
  userId: string,
): Promise<void> {
  const { token } = await mintBetterAuthSession({
    userId,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });
  await appendBetterAuthSessionCookie(headers, token);
  // requireAuth tries the legacy cookie first, so a leftover one would keep the
  // browser signed in as whoever it belonged to.
  clearSessionCookie(headers);
}
