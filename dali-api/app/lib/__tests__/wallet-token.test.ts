import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The token functions only read process.env at call time, so setting the secret
// per-test is enough. prisma is mocked away since these tests exercise the pure
// sign/verify crypto, not ensure/rotate.
vi.mock("~/lib/db", () => ({ prisma: {} }));

import {
  signWalletToken,
  verifyWalletToken,
  memberIdFromToken,
  walletTokensConfigured,
} from "~/lib/wallet-token";

const GLOBAL = "test-wallet-global-secret";
const MEMBER = "member-secret-abc";

beforeEach(() => {
  process.env.WALLET_PASS_SECRET = GLOBAL;
});
afterEach(() => {
  delete process.env.WALLET_PASS_SECRET;
});

describe("wallet-token", () => {
  it("round-trips a signed token back to its memberId", () => {
    const token = signWalletToken("u1", MEMBER);
    expect(memberIdFromToken(token)).toBe("u1");
    expect(verifyWalletToken(token, MEMBER)).toEqual({ ok: true, memberId: "u1" });
  });

  it("rejects a tampered signature", () => {
    const token = signWalletToken("u1", MEMBER);
    const flipped = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(verifyWalletToken(flipped, MEMBER)).toEqual({ ok: false });
  });

  it("rejects verification with the wrong per-member secret (revocation)", () => {
    const token = signWalletToken("u1", MEMBER);
    // Rotating the member's secret is exactly this: the old token no longer
    // verifies against the new secret.
    expect(verifyWalletToken(token, "rotated-new-secret")).toEqual({ ok: false });
  });

  it("rejects verification when the global secret has changed", () => {
    const token = signWalletToken("u1", MEMBER);
    process.env.WALLET_PASS_SECRET = "a-different-global-secret";
    expect(verifyWalletToken(token, MEMBER)).toEqual({ ok: false });
  });

  it("rejects a null member secret (no pass / revoked to nothing)", () => {
    const token = signWalletToken("u1", MEMBER);
    expect(verifyWalletToken(token, null)).toEqual({ ok: false });
  });

  it("rejects a structurally malformed token", () => {
    expect(verifyWalletToken("not-a-token", MEMBER)).toEqual({ ok: false });
    expect(verifyWalletToken("v1.u1", MEMBER)).toEqual({ ok: false });
    expect(memberIdFromToken("garbage")).toBeNull();
    expect(memberIdFromToken("v2.u1.sig")).toBeNull();
  });

  it("is disabled (and never verifies) without a global secret", () => {
    // Sign while configured, then unset the secret.
    const token = signWalletToken("u1", MEMBER);
    delete process.env.WALLET_PASS_SECRET;
    expect(walletTokensConfigured()).toBe(false);
    expect(verifyWalletToken(token, MEMBER)).toEqual({ ok: false });
  });
});
