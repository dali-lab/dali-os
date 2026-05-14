import crypto from "node:crypto";

// Slack v0 signing scheme: HMAC-SHA256 of "v0:{ts}:{rawBody}" keyed by
// the app's signing secret. Slack rejects requests older than 5 minutes
// upstream; we mirror that here to bound replay attacks.
const MAX_SKEW_SECONDS = 60 * 5;

export type VerifySignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing-headers" | "stale" | "bad-signature" };

export function verifySlackSignature(args: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: () => number;
}): VerifySignatureResult {
  const { signingSecret, timestamp, signature, rawBody } = args;
  if (!timestamp || !signature) return { ok: false, reason: "missing-headers" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "missing-headers" };

  const nowSec = Math.floor((args.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSec - tsNum) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "bad-signature" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  return { ok: true };
}
