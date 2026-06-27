// POST /auth/pair/poll — unauthenticated. The desktop app polls with the raw
// deviceCode. Returns the pairing status. On the first poll after approval
// (Approved + not yet minted) it mints the long-lived desktop Session (the
// keychain Bearer for the background poller) and a one-time handoff code, flips
// the row to Consumed in one atomic guarded write, and returns both to the app.
// See TAURI_DESKTOP_PLAN.md.

import type { Route } from "./+types/auth.pair.poll";
import { prisma } from "~/lib/db";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import { getApiBaseUrl } from "~/lib/app-env";
import { logAuditEvent } from "~/lib/audit";
import { issueSession, hashSessionId, revokeSession } from "~/lib/session";
import {
  hashCode,
  generateRawCode,
  desktopPollerUserAgent,
  DESKTOP_ABSOLUTE_TTL_MS,
  HANDOFF_TTL_MS,
  POLL_INTERVAL_SECONDS,
} from "~/lib/pairing";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Coarse per-IP cap → genuine 429 (abuse). Per-device throttle below → slow_down.
  const ipLimited = checkRateLimit(
    request,
    { max: 60, windowMs: 60_000 },
    `pair-poll-ip:${getClientIp(request)}`,
  );
  if (ipLimited) return ipLimited;

  let deviceCode: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body.deviceCode === "string") deviceCode = body.deviceCode;
  } catch {
    // fall through to 400
  }
  if (!deviceCode) {
    return Response.json({ error: "Missing deviceCode" }, { status: 400 });
  }

  const deviceCodeHash = hashCode(deviceCode);

  // Per-device slow_down: at most one poll / 3s. Translate the limiter's 429
  // into the device-flow `slow_down` signal the app honors.
  const tooFast = checkRateLimit(request, { max: 1, windowMs: 3000 }, `pair-poll:${deviceCodeHash}`);
  if (tooFast) {
    return Response.json({ status: "slow_down", interval: POLL_INTERVAL_SECONDS });
  }

  const row = await prisma.devicePairing.findUnique({ where: { deviceCodeHash } });
  const now = new Date();

  // Unknown code and expiry collapse to the same response — no enumeration leak.
  if (!row) return Response.json({ status: "expired" });

  switch (row.status) {
    case "Cancelled":
      return Response.json({ status: "denied" });
    case "Consumed":
      return Response.json({ status: "already_used" });
    case "Expired":
      return Response.json({ status: "expired" });
    case "Pending": {
      if (row.expiresAt < now) {
        await prisma.devicePairing.updateMany({
          where: { id: row.id, status: "Pending" },
          data: { status: "Expired" },
        });
        return Response.json({ status: "expired" });
      }
      return Response.json({ status: "pending", interval: POLL_INTERVAL_SECONDS });
    }
    case "Approved":
      break; // mint path below
  }

  // Approved. userId is bound at approval; guard defensively.
  if (!row.userId) {
    return Response.json({ status: "pending", interval: POLL_INTERVAL_SECONDS });
  }
  // Already minted but somehow still Approved → treat as consumed.
  if (row.desktopSessionId) {
    return Response.json({ status: "already_used" });
  }

  // Mint the keychain desktop Session (Bearer for the background poller). Longer
  // absolute TTL than the webview cookie so notifications don't lapse mid-month.
  const desktop = await issueSession({
    userId: row.userId,
    absoluteTtlMs: DESKTOP_ABSOLUTE_TTL_MS,
    userAgent: desktopPollerUserAgent({ host: row.deviceLabel }),
    ip: getClientIp(request),
  });
  const desktopSessionId = hashSessionId(desktop.rawId);

  // Mint the one-time handoff code (planted into the webview cookie jar by
  // /auth/handoff). 60s, single-use.
  const handoffCode = generateRawCode();
  const handoffCodeHash = hashCode(handoffCode);

  // Atomic claim: only the poll that finds Approved + unminted wins. A loser of
  // a concurrent race must not strand the session it just minted.
  const claim = await prisma.devicePairing.updateMany({
    where: { id: row.id, status: "Approved", desktopSessionId: null },
    data: {
      status: "Consumed",
      desktopSessionId,
      handoffCodeHash,
      handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    },
  });
  if (claim.count === 0) {
    await revokeSession(desktopSessionId, { hashed: true });
    return Response.json({ status: "already_used" });
  }

  await logAuditEvent({ action: "pairing.consume", userId: row.userId, request });

  return Response.json({
    status: "approved",
    desktopToken: desktop.rawId,
    handoffCode,
    handoffUrl: `${getApiBaseUrl()}/auth/handoff?code=${encodeURIComponent(handoffCode)}`,
    absoluteExpiresAt: desktop.absoluteExpiresAt.toISOString(),
  });
}
