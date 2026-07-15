// Device-pairing helpers for the Tauri desktop sign-in flow. Mirrors the
// hashing/encoding conventions in lib/session.ts. See TAURI_DESKTOP_PLAN.md.
//
// Two kinds of code travel in this flow:
//   - deviceCode / handoffCode: high-entropy bearer secrets (32 random bytes,
//     base64url). Stored only as sha256(raw) — the raw value lives in the app
//     and in transit, never in the DB.
//   - userCode: a short human-eyeballed code the user compares between the app
//     and the /link approval page. Not a bearer secret (approval needs an
//     authenticated web session), so low entropy is acceptable.

import { createHash, randomBytes, randomInt } from "node:crypto";

// Rolling vs absolute TTLs for the keychain desktop Session (the background
// notification poller's Bearer token). Rolling = 30 days (matches the webview
// cookie) but the absolute cap is 90 days so notifications don't silently lapse
// mid-month; the poller hits requireAuth constantly, which keeps the rolling
// expiry fresh up to this cap. After 90 days the device must re-pair.
export const DESKTOP_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Pairing-request lifetime: the window between /auth/pair/start and approval.
export const PAIRING_TTL_MS = 10 * 60 * 1000;

// One-time handoff code lifetime: minted on the consuming poll, redeemed almost
// immediately by /auth/handoff.
export const HANDOFF_TTL_MS = 60 * 1000;

// Suggested polling cadence handed back to the app at /auth/pair/start.
export const POLL_INTERVAL_SECONDS = 5;

// Unambiguous alphabet for the human userCode — no 0/O, 1/I/L which users
// confuse when eyeball-comparing the app code to the /link page.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const USER_CODE_LENGTH = 8;

// 32 random bytes → 43 base64url chars. Same shape/entropy as a raw session id.
export function generateRawCode(): string {
  return randomBytes(32).toString("base64url");
}

// sha256(raw) → base64url. Same scheme as hashSessionId / OneTimeToken.tokenHash.
export function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

// 8 chars from the safe alphabet, unbiased (randomInt rejection-samples).
export function generateUserCode(): string {
  let out = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return out;
}

// Canonical form for lookup: uppercase, strip everything that isn't a letter or
// digit (so "wxyz-1234", "wxyz 1234" and "WXYZ1234" all match the same row).
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Display form: WXYZ-1234. Splits at the midpoint; leaves odd lengths ungrouped.
export function formatUserCode(code: string): string {
  const c = normalizeUserCode(code);
  if (c.length !== USER_CODE_LENGTH) return c;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

// User-Agent strings stamped on the issued Session rows so paired devices are
// recognizable on the Settings → Your devices page (settings.sessions.tsx
// matches /DALI OS Desktop/i). The poller token and the webview cookie session
// are distinct credentials with distinct TTLs, hence distinct labels.
export function desktopPollerUserAgent(opts: {
  version?: string;
  os?: string;
  host?: string;
}): string {
  const meta = [opts.os, opts.host].filter(Boolean).join("; ");
  const ver = opts.version ? `/${opts.version}` : "";
  return `DALI OS Desktop${ver}${meta ? ` (${meta})` : ""}`;
}

export function desktopWebviewUserAgent(opts: {
  version?: string;
  os?: string;
}): string {
  const ver = opts.version ? `/${opts.version}` : "";
  return `DALI OS Desktop (webview)${ver}${opts.os ? ` (${opts.os})` : ""}`;
}
