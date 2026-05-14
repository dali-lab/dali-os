import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySlackSignature } from "../verify-signature";

const SECRET = "test-signing-secret";

function sign(ts: string, body: string): string {
  return (
    "v0=" + crypto.createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")
  );
}

describe("verifySlackSignature", () => {
  const now = () => 1_700_000_000_000;
  const fresh = String(Math.floor(now() / 1000));

  it("accepts a correctly-signed fresh request", () => {
    const body = `{"hello":"world"}`;
    const sig = sign(fresh, body);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: fresh,
        signature: sig,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a request with a tampered body", () => {
    const body = `{"hello":"world"}`;
    const sig = sign(fresh, body);
    const res = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: fresh,
      signature: sig,
      rawBody: `{"hello":"WORLD"}`,
      now,
    });
    expect(res).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a stale timestamp", () => {
    const body = `{}`;
    const stale = String(Math.floor(now() / 1000) - 60 * 10);
    const sig = sign(stale, body);
    const res = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: stale,
      signature: sig,
      rawBody: body,
      now,
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects missing headers", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: null,
        signature: "v0=abc",
        rawBody: "{}",
        now,
      }),
    ).toEqual({ ok: false, reason: "missing-headers" });
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: fresh,
        signature: null,
        rawBody: "{}",
        now,
      }),
    ).toEqual({ ok: false, reason: "missing-headers" });
  });

  it("rejects non-numeric timestamp", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: "not-a-number",
        signature: "v0=abc",
        rawBody: "{}",
        now,
      }),
    ).toEqual({ ok: false, reason: "missing-headers" });
  });

  it("rejects wrong-length signature without throwing in timingSafeEqual", () => {
    const body = "{}";
    const res = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: fresh,
      signature: "v0=tooshort",
      rawBody: body,
      now,
    });
    expect(res).toEqual({ ok: false, reason: "bad-signature" });
  });
});
