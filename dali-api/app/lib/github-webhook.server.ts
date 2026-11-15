import crypto from "node:crypto";

// GitHub webhook signature: HMAC-SHA256 of the raw body, keyed by the webhook
// secret, sent as `sha256=<hex>` in `X-Hub-Signature-256`.
export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "bad" };

export function verifyGithubSignature(args: {
  secret: string;
  signature: string | null;
  rawBody: string;
}): VerifyResult {
  if (!args.signature) return { ok: false, reason: "missing" };

  const expected =
    "sha256=" + crypto.createHmac("sha256", args.secret).update(args.rawBody).digest("hex");

  const a = Buffer.from(args.signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "bad" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad" };
  return { ok: true };
}
