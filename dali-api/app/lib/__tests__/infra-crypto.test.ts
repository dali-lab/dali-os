import { describe, it, expect, beforeAll } from "vitest";

import {
  encryptSecret,
  decryptSecret,
  infraCryptoConfigured,
} from "~/lib/infra/crypto.server";

// AES-256-GCM at-rest encryption for Fly tokens. A 32-byte key as 64 hex chars.
beforeAll(() => {
  process.env.INFRA_SECRET_KEY = "a".repeat(64);
});

describe("infra token crypto", () => {
  it("reports configured with a valid 32-byte key", () => {
    expect(infraCryptoConfigured()).toBe(true);
  });

  it("round-trips a token and never stores it in the clear", () => {
    const plain = "FlyV1 fm2_pretend_token_value";
    const enc = encryptSecret(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("uses a fresh IV per call (ciphertext differs for equal input)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptSecret("secret");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered-bytes").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-blob")).toThrow();
  });
});
