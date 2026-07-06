// POST /auth/pair/start — unauthenticated. The desktop app calls this to begin
// device pairing. Creates a Pending DevicePairing row and returns the raw
// deviceCode (the app polls with it), the human userCode (the user eyeball-
// compares it on /link), and the verification URL to open in the system
// browser. See TAURI_DESKTOP_PLAN.md.

import type { Route } from "./+types/auth.pair.start";
import { prisma } from "~/lib/db";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import { getApiBaseUrl } from "~/lib/app-env";
import { logAuditEvent } from "~/lib/audit";
import {
  generateRawCode,
  generateUserCode,
  hashCode,
  formatUserCode,
  PAIRING_TTL_MS,
  POLL_INTERVAL_SECONDS,
} from "~/lib/pairing";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Cap code farming. 10 starts / 10 min per IP.
  const limited = checkRateLimit(request, { max: 10, windowMs: PAIRING_TTL_MS });
  if (limited) return limited;

  let deviceLabel = "Unknown device";
  try {
    const body = await request.json();
    if (body && typeof body.deviceLabel === "string") {
      deviceLabel = body.deviceLabel.trim().slice(0, 120) || "Unknown device";
    }
  } catch {
    // Empty / non-JSON body → default label.
  }

  // Generate codes; retry the rare unique collision on userCode / deviceCodeHash.
  let deviceCode = "";
  let userCode = "";
  let created = false;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    deviceCode = generateRawCode();
    userCode = generateUserCode();
    try {
      await prisma.devicePairing.create({
        data: {
          deviceCodeHash: hashCode(deviceCode),
          userCode,
          deviceLabel,
          status: "Pending",
          expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
          startIp: getClientIp(request),
          startUserAgent: request.headers.get("user-agent") ?? undefined,
        },
      });
      created = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (!created) {
    return Response.json({ error: "Could not allocate a pairing code" }, { status: 503 });
  }

  await logAuditEvent({ action: "pairing.start", request });

  const display = formatUserCode(userCode);
  return Response.json({
    deviceCode,
    userCode: display,
    verificationUrl: `${getApiBaseUrl()}/link?code=${encodeURIComponent(display)}`,
    expiresIn: Math.floor(PAIRING_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  });
}
