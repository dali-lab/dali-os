import { clearSessionCookie, setSessionCookie } from "~/lib/cookies";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getClientIp } from "~/lib/request-meta";
import { issueSession } from "~/lib/session";

// Signs `userId` in on the response carrying `headers`. The legacy branch only
// survives because e2e and local dev still run with the `betterauth` flag off;
// it goes when the flag does (specs/betterauth-legacy-auth-cleanup.md, Phase 3).
export async function startLoginSession(
  headers: Headers,
  request: Request,
  userId: string,
): Promise<void> {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;

  if (await isFeatureEnabledForEveryone("betterauth", request)) {
    const { mintBetterAuthSession } = await import("~/lib/betterauth-session.server");
    const { appendBetterAuthSessionCookie } = await import("~/lib/betterauth-cookie.server");
    const { token } = await mintBetterAuthSession({ userId, ipAddress: ip, userAgent });
    await appendBetterAuthSessionCookie(headers, token);
    // requireAuth tries the legacy cookie first, so a leftover one would keep
    // the browser signed in as whoever it belonged to.
    clearSessionCookie(headers);
    return;
  }

  const session = await issueSession({ userId, ip, userAgent });
  setSessionCookie(headers, session.rawId);
}
