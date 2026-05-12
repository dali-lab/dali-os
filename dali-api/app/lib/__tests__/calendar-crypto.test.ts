import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "~/lib/calendar-crypto";

beforeAll(() => {
  process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("base64");
});

describe("calendar-crypto", () => {
  it("round-trips a plaintext string", () => {
    const plaintext = JSON.stringify({ accessToken: "abc.def.ghi", refreshToken: "rT" });
    const ct = encrypt(plaintext);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it("produces different ciphertext for the same input (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    const ct = encrypt("hello");
    const parts = ct.split(":");
    // Flip one byte in the ciphertext body.
    const tampered = Buffer.from(parts[3], "base64");
    tampered[0] ^= 1;
    parts[3] = tampered.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    const ct = encrypt("hello");
    const bad = ct.replace(/^v1:/, "v9:");
    expect(() => decrypt(bad)).toThrow(/Unrecognized ciphertext format/);
  });

  it("rejects a missing key env", () => {
    const saved = process.env.CALENDAR_TOKEN_KEY;
    delete process.env.CALENDAR_TOKEN_KEY;
    expect(() => encrypt("hello")).toThrow(/CALENDAR_TOKEN_KEY/);
    process.env.CALENDAR_TOKEN_KEY = saved;
  });

  it("rejects a key of the wrong length", () => {
    const saved = process.env.CALENDAR_TOKEN_KEY;
    process.env.CALENDAR_TOKEN_KEY = Buffer.from("too short").toString("base64");
    expect(() => encrypt("hello")).toThrow(/32 bytes/);
    process.env.CALENDAR_TOKEN_KEY = saved;
  });
});
