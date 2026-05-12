import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with a 12-byte IV. Versioned ciphertext format:
//   v1:<iv-b64>:<tag-b64>:<ct-b64>
// The prefix lets us rotate or migrate to a different scheme without a
// schema migration — future versions just store the new prefix.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.CALENDAR_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "CALENDAR_TOKEN_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`CALENDAR_TOKEN_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized ciphertext format");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
