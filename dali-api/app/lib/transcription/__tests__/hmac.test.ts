import { describe, it, expect } from "vitest";
import { signHmac, verifyHmac } from "~/lib/transcription/hmac";

const SECRET = "test-secret";

describe("verifyHmac", () => {
  it("accepts a correctly signed, fresh callback", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const rawBody = JSON.stringify({ recordingId: "r1" });
    const signature = signHmac(SECRET, timestamp, rawBody);

    expect(verifyHmac({ secret: SECRET, timestamp, signature, rawBody, now })).toBe(true);
  });

  it("rejects a bad signature", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const rawBody = JSON.stringify({ recordingId: "r1" });

    expect(
      verifyHmac({ secret: SECRET, timestamp, signature: "sha256=deadbeef", rawBody, now }),
    ).toBe(false);
  });

  it("rejects a stale timestamp outside the 5-minute window", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const timestamp = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    const rawBody = JSON.stringify({ recordingId: "r1" });
    const signature = signHmac(SECRET, timestamp, rawBody);

    expect(verifyHmac({ secret: SECRET, timestamp, signature, rawBody, now })).toBe(false);
  });

  it("rejects replay of an old signature stamped with a fresh timestamp", () => {
    const earlier = new Date("2026-10-09T11:00:00Z");
    const now = new Date("2026-10-09T12:00:00Z");
    const rawBody = JSON.stringify({ recordingId: "r1" });
    const oldSignature = signHmac(SECRET, String(Math.floor(earlier.getTime() / 1000)), rawBody);
    const freshTimestamp = String(Math.floor(now.getTime() / 1000));

    // The attacker swaps in a timestamp that passes the window check, but the
    // signature still covers the OLD timestamp, so it no longer matches.
    expect(
      verifyHmac({ secret: SECRET, timestamp: freshTimestamp, signature: oldSignature, rawBody, now }),
    ).toBe(false);
  });

  it("rejects a missing timestamp or signature", () => {
    const rawBody = "{}";
    expect(verifyHmac({ secret: SECRET, timestamp: null, signature: "sha256=x", rawBody })).toBe(false);
    expect(verifyHmac({ secret: SECRET, timestamp: "123", signature: null, rawBody })).toBe(false);
  });
});
