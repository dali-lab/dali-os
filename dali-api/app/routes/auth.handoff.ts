// GET /auth/handoff?code=<handoffCode> — redeemed inside the desktop webview.
// Validates the single-use handoff code and plants a fresh 30-day webview cookie
// session into the webview's cookie jar, then redirects to /. The 30-day session
// id is born here via Set-Cookie and never travels in a URL; only the single-use,
// 60-second handoff code does. See TAURI_DESKTOP_PLAN.md.

import { redirect } from "react-router";
import type { Route } from "./+types/auth.handoff";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/rate-limit";
import { logAuditEvent } from "~/lib/audit";
import { hashCode, desktopWebviewUserAgent } from "~/lib/pairing";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return redirect("/login?error=handoff_invalid");

  const handoffCodeHash = hashCode(code);
  const now = new Date();

  // Atomic single-use claim: only an unused, unexpired handoff redeems.
  const claim = await prisma.devicePairing.updateMany({
    where: { handoffCodeHash, handoffUsedAt: null, handoffExpiresAt: { gt: now } },
    data: { handoffUsedAt: now },
  });
  if (claim.count === 0) return redirect("/login?error=handoff_invalid");

  const row = await prisma.devicePairing.findFirst({ where: { handoffCodeHash } });
  if (!row?.userId) return redirect("/login?error=handoff_invalid");

  const headers = new Headers();

  // Flag-gated: when betterauth is on, mint a BetterAuth session and plant it as
  // the signed `dali.session_token` cookie so the webview is authenticated via
  // auth.api.getSession. The handoff contract (code validation, single-use claim,
  // redirect to /) is unchanged — only the session store backing the cookie changes.
  //
  // NOTE: The cookie round-trip (does auth.api.getSession accept the cookie
  // produced by appendBetterAuthSessionCookie?) MUST be verified in an integration
  // test against a real BetterAuth instance before enabling the betterauth flag.
  if (await isFeatureEnabledForEveryone("betterauth", request)) {
    const s = await mintBetterAuthSession({
      userId: row.userId,
      userAgent: desktopWebviewUserAgent({ os: row.deviceLabel }),
      ipAddress: getClientIp(request),
    });
    await appendBetterAuthSessionCookie(headers, s.token);
  } else {
    const webview = await issueSession({
      userId: row.userId,
      userAgent: desktopWebviewUserAgent({ os: row.deviceLabel }),
      ip: getClientIp(request),
    });
    setSessionCookie(headers, webview.rawId);
  }

  // The desktop shell rides the same tabless-by-default shell as the web app.
  // Its bare WKWebView has no browser chrome, but tabless mode supplies its own
  // back/forward arrows in the desktop top bar (TablessHistoryNav), so there's nothing to
  // force here — a fresh pairing plants no preference and takes the default.
  await logAuditEvent({ action: "pairing.handoff", userId: row.userId, request });
  return redirect("/", { headers });
}
