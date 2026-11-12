// Modal's result callback is unauthenticated (no session), so it's verified
// by HMAC instead: sha256(DIARIZE_SECRET, "${timestamp}.${rawBody}"), sent as
// headers X-Dali-Timestamp / X-Dali-Signature: sha256=<hex>. Same shape as
// github-webhook.ts's signature check, plus a timestamp window so an old,
// intercepted callback can't be replayed indefinitely.

import crypto from "node:crypto";

const WINDOW_SECONDS = 5 * 60;

export function signHmac(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyHmac(args: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: Date;
}): boolean {
  const { secret, timestamp, signature, rawBody, now = new Date() } = args;
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > WINDOW_SECONDS) return false;

  const expected = signHmac(secret, timestamp, rawBody);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
