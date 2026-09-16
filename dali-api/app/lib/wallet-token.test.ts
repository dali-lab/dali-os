import { describe, expect, it, beforeEach, vi } from "vitest";

// wallet-token imports prisma at module level; mock the module so tests don't
// need a real DB connection.
vi.mock("~/lib/db");

import { signWalletAuthToken, verifyWalletAuthToken } from "./wallet-token";

describe("signWalletAuthToken / verifyWalletAuthToken", () => {
  beforeEach(() => {
    process.env.WALLET_PASS_SECRET = "test-secret-for-wallet-token-tests";
  });

  it("verifies a token signed for the same memberId", () => {
    const token = signWalletAuthToken("member-abc");
    expect(verifyWalletAuthToken("member-abc", token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = signWalletAuthToken("member-abc");
    const tampered = token.slice(0, -4) + "XXXX";
    expect(verifyWalletAuthToken("member-abc", tampered)).toBe(false);
  });

  it("rejects a valid token presented for a different memberId", () => {
    const token = signWalletAuthToken("member-abc");
    expect(verifyWalletAuthToken("member-other", token)).toBe(false);
  });

  it("returns false when WALLET_PASS_SECRET is unset", () => {
    const token = signWalletAuthToken("member-abc");
    delete process.env.WALLET_PASS_SECRET;
    expect(verifyWalletAuthToken("member-abc", token)).toBe(false);
  });

  it("produces a deterministic token for the same memberId and secret", () => {
    const a = signWalletAuthToken("member-abc");
    const b = signWalletAuthToken("member-abc");
    expect(a).toBe(b);
  });

  it("produces distinct tokens for different memberIds", () => {
    const a = signWalletAuthToken("member-abc");
    const b = signWalletAuthToken("member-xyz");
    expect(a).not.toBe(b);
  });
});
