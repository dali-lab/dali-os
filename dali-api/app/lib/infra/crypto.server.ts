// AES-256-GCM encryption for infra provider tokens at rest (InfraProject Fly
// tokens). Keyed by INFRA_SECRET_KEY — a 32-byte key provided as 64-char hex or
// base64. Encrypted values are stored as "v1:<iv b64>:<tag b64>:<ct b64>", a
// self-describing format with a unique IV per value. Server-only (.server.ts) so
// node:crypto never reaches the client bundle.

import crypto from "node:crypto";

const PREFIX = "v1";

function key(): Buffer {
  const raw = process.env.INFRA_SECRET_KEY;
  if (!raw) throw new Error("INFRA_SECRET_KEY is not set");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("INFRA_SECRET_KEY must decode to 32 bytes (64 hex chars or base64)");
  }
  return buf;
}

// Whether encryption is usable — the registry UI disables token entry when not.
export function infraCryptoConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("malformed encrypted secret");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}
