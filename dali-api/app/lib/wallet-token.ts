import crypto from "node:crypto";
import { prisma } from "~/lib/db";

// Signed member token carried in the barcode of a member's Apple/Google Wallet
// membership pass. Format:
//
//   v1.<memberId>.<sig>
//
// where sig = base64url( HMAC-SHA256(WALLET_PASS_SECRET, "v1.<memberId>.<memberSecret>") )
// truncated to SIG_BYTES. Two secrets combine on purpose:
//
//  - WALLET_PASS_SECRET (global env) means a DB-only leak can't forge a token —
//    an attacker needs the env key too.
//  - User.walletPassSecret (per member) is the revocation lever: rotating it
//    invalidates every barcode that member ever downloaded, without touching
//    anyone else. See rotateWalletSecret.
//
// The barcode is a durable bearer identifier (a Wallet pass can't silently
// re-issue its barcode without an Apple pass web service), so it does NOT
// rotate on a timer. Verification is per-member — the scan endpoint loads the
// member row (for the mark anyway) and passes their current secret here, so the
// check is pure CPU. Empty WALLET_PASS_SECRET disables the whole feature,
// mirroring the SLACK_SIGNING_SECRET / GITHUB_WEBHOOK_SECRET "empty = off"
// convention.

const VERSION = "v1";
const SIG_BYTES = 20;

function globalSecret(): string | null {
  const s = process.env.WALLET_PASS_SECRET;
  return s && s.length > 0 ? s : null;
}

/** Whether wallet-pass check-in is enabled at all (global signing secret set). */
export function walletTokensConfigured(): boolean {
  return globalSecret() !== null;
}

function computeSig(memberId: string, memberSecret: string): string {
  const key = globalSecret();
  if (!key) throw new Error("WALLET_PASS_SECRET is not set");
  return crypto
    .createHmac("sha256", key)
    .update(`${VERSION}.${memberId}.${memberSecret}`)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString("base64url");
}

/** Build the barcode payload for a member given their current per-member secret. */
export function signWalletToken(memberId: string, memberSecret: string): string {
  return `${VERSION}.${memberId}.${computeSig(memberId, memberSecret)}`;
}

export type WalletTokenResult = { ok: true; memberId: string } | { ok: false };

/**
 * Verify a scanned barcode against a member's current secret. `memberSecret` is
 * the member's live User.walletPassSecret — pass null for a member with no pass
 * (or one revoked to null), which always fails. Never trust the memberId inside
 * the token for a mark until this returns ok: the signature binds it to the
 * per-member secret.
 */
export function verifyWalletToken(
  token: string,
  memberSecret: string | null,
): WalletTokenResult {
  if (!walletTokensConfigured() || !memberSecret) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  const [version, memberId, sig] = parts;
  if (version !== VERSION || !memberId || !sig) return { ok: false };

  const expected = computeSig(memberId, memberSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, memberId };
}

/**
 * Parse the memberId out of a token WITHOUT verifying — used only to look up
 * the member row (and thus their secret) before the real verifyWalletToken
 * check. Returns null for a structurally invalid token.
 */
export function memberIdFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1]) return null;
  return parts[1];
}

/**
 * The member's per-member wallet secret, generating + storing one on first use.
 * Called when a member downloads/saves their pass so the barcode has something
 * stable to sign against.
 */
export async function ensureWalletSecret(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletPassSecret: true },
  });
  if (user?.walletPassSecret) return user.walletPassSecret;
  const secret = crypto.randomBytes(24).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: { walletPassSecret: secret },
  });
  return secret;
}

/**
 * Revoke a member's wallet pass by rotating their secret: every barcode they've
 * downloaded stops verifying immediately. The stale pass still visually shows
 * the (now dead) barcode until they delete + re-add it — we can't push a new
 * one without an Apple pass web service — but a dead barcode can't mark anyone
 * present, and re-adding mints a working one.
 */
export async function rotateWalletSecret(userId: string): Promise<void> {
  const secret = crypto.randomBytes(24).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: { walletPassSecret: secret },
  });
}
