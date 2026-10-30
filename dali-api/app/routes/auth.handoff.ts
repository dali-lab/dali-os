// GET /auth/handoff?code=<handoffCode>[&next=/path] — redeemed inside the desktop
// webview (or the mobile app's note editor WebView, which passes `next`).
// Validates the single-use handoff code and plants a fresh 30-day webview cookie
// session into the webview's cookie jar, then redirects to `next` (same-origin
// paths only) or /. The 30-day session
// id is born here via Set-Cookie and never travels in a URL; only the single-use,
// 60-second handoff code does. See TAURI_DESKTOP_PLAN.md.

import { redirect } from "react-router";
import type { Route } from "./+types/auth.handoff";
import { prisma } from "~/lib/db.server";
import { getClientIp } from "~/lib/rate-limit";
import { logAuditEvent } from "~/lib/audit";
import { hashCode, desktopWebviewUserAgent } from "~/lib/pairing";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";
import { clearSessionCookie } from "~/lib/cookies";
import { pickSafeLoginNext } from "~/lib/login-next";

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

  const s = await mintBetterAuthSession({
    userId: row.userId,
    userAgent: desktopWebviewUserAgent({ os: row.deviceLabel }),
    ipAddress: getClientIp(request),
  });
  await appendBetterAuthSessionCookie(headers, s.token);
  // requireAuth tries the legacy cookie first; a leftover one would shadow this.
  clearSessionCookie(headers);

  // The desktop shell rides the same tabless-by-default shell as the web app.
  // Its bare WKWebView has no browser chrome, but tabless mode supplies its own
  // back/forward arrows in the desktop top bar (TablessHistoryNav), so there's nothing to
  // force here — a fresh pairing plants no preference and takes the default.
  await logAuditEvent({ action: "pairing.handoff", userId: row.userId, request });
  return redirect(pickSafeLoginNext(url.searchParams.get("next")) ?? "/", { headers });
}
