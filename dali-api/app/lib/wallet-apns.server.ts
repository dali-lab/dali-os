// APNs push notifications for Apple Wallet pass updates.
//
// When a member's pass barcode changes (e.g. after rotateWalletSecret), we push
// an APNs notification to every device that has the pass registered. The device
// then polls our PassKit web service to fetch the fresh pass. This is the
// "silent update" flow Apple's PassKit web service spec prescribes.
//
// Auth: APNs accepts TLS mutual auth (cert + key) as an alternative to JWT
// tokens — we reuse the SAME Pass Type ID cert already used to sign .pkpass
// files, so no new credential is needed.

import http2 from "node:http2";
import { prisma } from "~/lib/db";
import { walletAppleConfigured } from "~/lib/wallet-apple.server";

// APNs host: prod by default. Point at the sandbox host during development
// by setting APPLE_PASS_APNS_HOST=https://api.sandbox.push.apple.com.
function walletApnsHost(): string {
  return process.env.APPLE_PASS_APNS_HOST ?? "https://api.push.apple.com";
}

/**
 * Bump the pass-update tag and push an APNs notification to every device that
 * has this member's pass installed, prompting the device to re-fetch the pass
 * from our PassKit web service.
 *
 * Safe to fire-and-forget: push failures are logged but never thrown to the
 * caller. No-ops gracefully when Apple Wallet is unconfigured (dev/staging).
 */
export async function pushWalletPassUpdate(userId: string): Promise<void> {
  // No-op when certs aren't configured — mirrors the 503 pattern on pass build.
  if (!walletAppleConfigured()) return;

  // Bump the tag so the "passes updated since" endpoint returns this pass.
  await prisma.user.update({
    where: { id: userId },
    data: { walletPassUpdatedAt: new Date() },
  });

  const registrations = await prisma.walletPassRegistration.findMany({
    where: { serialNumber: userId },
  });
  if (registrations.length === 0) return;

  // Normalize escaped newlines — hosting platforms often store PEMs with
  // literal \n sequences.
  const cert = process.env.APPLE_PASS_CERT_PEM!.replace(/\\n/g, "\n");
  const key = process.env.APPLE_PASS_KEY_PEM!.replace(/\\n/g, "\n");
  const passphrase = process.env.APPLE_PASS_KEY_PASSPHRASE || undefined;
  const passTypeId = process.env.APPLE_PASS_TYPE_ID!;

  // Open one TLS-authenticated http2 session for all tokens in this call.
  let session: http2.ClientHttp2Session;
  try {
    session = await new Promise<http2.ClientHttp2Session>((resolve, reject) => {
      const s = http2.connect(walletApnsHost(), {
        cert,
        key,
        ...(passphrase ? { passphrase } : {}),
      });
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
  } catch (err) {
    console.warn("[wallet-apns] failed to open APNs session:", err);
    return;
  }

  const toDelete: string[] = [];

  for (const reg of registrations) {
    try {
      const status = await sendApnsPush(session, reg.pushToken, passTypeId);
      if (status === 410) {
        // 410 Gone: device has unregistered the pass. Clean up the row so we
        // don't keep pushing to a dead token.
        toDelete.push(reg.id);
      }
    } catch (err) {
      // A per-device push failure shouldn't abort the loop or surface to the
      // caller — the pass will update on next manual open.
      console.warn(`[wallet-apns] push failed for token ${reg.pushToken}:`, err);
    }
  }

  session.close();

  if (toDelete.length > 0) {
    await prisma.walletPassRegistration.deleteMany({
      where: { id: { in: toDelete } },
    });
  }
}

/**
 * Send a single APNs push for a Wallet pass update.
 *
 * The push body is intentionally empty `{}` — for Wallet passes APNs is
 * purely a "go re-fetch" ping; the actual pass data comes from our PassKit
 * web service. The apns-topic MUST be the pass type identifier (not the app
 * bundle id) for wallet notifications.
 */
function sendApnsPush(
  session: http2.ClientHttp2Session,
  pushToken: string,
  passTypeId: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      "apns-topic": passTypeId,
      "content-type": "application/json",
    });

    req.write("{}");
    req.end();

    req.on("response", (headers) => {
      resolve(Number(headers[":status"] ?? 0));
    });

    req.on("error", reject);
  });
}
