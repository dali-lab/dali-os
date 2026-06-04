import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyGithubSignature } from "../github-webhook";

const SECRET = "test-webhook-secret";

function sign(body: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("accepts a correctly-signed body", () => {
    const body = `{"action":"closed"}`;
    expect(
      verifyGithubSignature({ secret: SECRET, signature: sign(body), rawBody: body }),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const body = `{"action":"closed"}`;
    const sig = sign(body);
    expect(
      verifyGithubSignature({
        secret: SECRET,
        signature: sig,
        rawBody: `{"action":"opened"}`,
      }),
    ).toEqual({ ok: false, reason: "bad" });
  });

  it("rejects a missing signature header", () => {
    expect(
      verifyGithubSignature({ secret: SECRET, signature: null, rawBody: "{}" }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a signature signed with the wrong secret", () => {
    const body = "{}";
    const wrong =
      "sha256=" + crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(
      verifyGithubSignature({ secret: SECRET, signature: wrong, rawBody: body }),
    ).toEqual({ ok: false, reason: "bad" });
  });

  it("rejects a malformed signature (length mismatch)", () => {
    expect(
      verifyGithubSignature({ secret: SECRET, signature: "sha256=deadbeef", rawBody: "{}" }),
    ).toEqual({ ok: false, reason: "bad" });
  });
});
