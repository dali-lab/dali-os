// TEMPORARY — remove ~1 week after the betterauth cutover has settled.
//
// Silent session upgrade. When a user arrives with a validated LEGACY session
// but no BetterAuth session, mint a BetterAuth session, plant its cookie, and
// clear the legacy cookie. This lets us drop legacy Session/CAS support at
// cleanup WITHOUT logging anyone out — active users migrate to BetterAuth
// cookies as they browse.
//
// Self-limiting: once the legacy cookie is cleared, the __dali_sid fast-path
// below skips all work, so the steady state is zero-cost. Safe because it only
// re-issues trust that is ALREADY live — it upgrades a validated legacy session
// (auth.ok), never a bare token, and it mints for the SAME userId.
//
// To remove: delete this module and its three call sites — app/routes/layout.tsx,
// app/routes/portal.tsx, and app/partners/routes/partner-layout.tsx.

import type { AuthResult } from "~/lib/auth";
import { COOKIE_SID, clearSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/rate-limit";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";

// Returns Set-Cookie headers to attach to the response, or null when there's
// nothing to do. Never throws — a migration hiccup must not break a page load.
export async function maybeUpgradeLegacyToBetterAuth(
  request: Request,
  auth: AuthResult,
): Promise<Headers | null> {
  if (!auth.ok) return null;

  // Fast path: no legacy cookie → nothing to upgrade (also true post-upgrade,
  // since we clear it), so the steady state costs one string check.
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes(`${COOKIE_SID}=`)) return null;

  if (!(await isFeatureEnabledForEveryone("betterauth", request))) return null;

  const headers = new Headers();

  // Already on a BetterAuth session? Then auth.ok came from BetterAuth and the
  // legacy cookie is just lingering — drop it so it can't shadow revocation.
  if (await getBetterAuthUser(request)) {
    clearSessionCookie(headers);
    return headers;
  }

  // auth.ok with no BetterAuth session ⇒ authenticated via legacy. Mint a
  // BetterAuth session for this user, plant its cookie, and clear the legacy one
  // so requireAuth stops preferring it and revocation targets the new session.
  try {
    const { token } = await mintBetterAuthSession({
      userId: auth.user.sub,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    await appendBetterAuthSessionCookie(headers, token);
    clearSessionCookie(headers);
    return headers;
  } catch {
    return null;
  }
}
