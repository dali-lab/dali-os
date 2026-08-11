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
import { hasExplicitTablessPreference, tablessCookieHeader } from "~/lib/tabless";

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

  const webview = await issueSession({
    userId: row.userId,
    userAgent: desktopWebviewUserAgent({ os: row.deviceLabel }),
    ip: getClientIp(request),
  });

  const headers = new Headers();
  setSessionCookie(headers, webview.rawId);
  // The desktop app's own window benefits from the tabbed workspace (its
  // back/forward history arrows in particular) the way a plain embedded page
  // wouldn't, so default a fresh desktop pairing into tab mode. Skipped if
  // this device already made an explicit choice, so re-pairing after a
  // sign-out doesn't clobber it.
  if (!hasExplicitTablessPreference(request)) {
    headers.append("Set-Cookie", tablessCookieHeader(false));
  }
  await logAuditEvent({ action: "pairing.handoff", userId: row.userId, request });
  return redirect("/", { headers });
}
