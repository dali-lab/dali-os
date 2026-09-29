// verifyCollabToken resolves the WS-handshake credential against both auth
// backends: a legacy __dali_sid session first, then a BetterAuth bearer token.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLookupSession = vi.hoisted(() => vi.fn());
const mockRollSession = vi.hoisted(() => vi.fn());
const mockVerifyBearer = vi.hoisted(() => vi.fn());

vi.mock("~/lib/session", () => ({
  lookupSession: mockLookupSession,
  rollSession: mockRollSession,
}));
vi.mock("~/lib/betterauth-compat.server", () => ({
  verifyBetterAuthBearerToken: mockVerifyBearer,
}));

import { verifyCollabToken } from "~/collab/auth";

const future = new Date(Date.now() + 1_000_000);
const past = new Date(Date.now() - 1_000_000);

beforeEach(() => {
  vi.clearAllMocks();
  mockRollSession.mockResolvedValue(undefined);
});

describe("verifyCollabToken", () => {
  it("accepts a valid legacy session and rolls it, without touching BetterAuth", async () => {
    mockLookupSession.mockResolvedValue({
      userId: "u1",
      revokedAt: null,
      expiresAt: future,
      absoluteExpiresAt: future,
    });
    expect(await verifyCollabToken("sid")).toEqual({ sub: "u1" });
    expect(mockRollSession).toHaveBeenCalled();
    expect(mockVerifyBearer).not.toHaveBeenCalled();
  });

  it("rejects a revoked legacy session", async () => {
    mockLookupSession.mockResolvedValue({
      userId: "u1",
      revokedAt: new Date(),
      expiresAt: future,
      absoluteExpiresAt: future,
    });
    await expect(verifyCollabToken("sid")).rejects.toThrow("Session revoked");
    expect(mockVerifyBearer).not.toHaveBeenCalled();
  });

  it("rejects an expired legacy session", async () => {
    mockLookupSession.mockResolvedValue({
      userId: "u1",
      revokedAt: null,
      expiresAt: past,
      absoluteExpiresAt: future,
    });
    await expect(verifyCollabToken("sid")).rejects.toThrow("Session expired");
  });

  it("falls back to a BetterAuth bearer token on a legacy miss", async () => {
    mockLookupSession.mockResolvedValue(null);
    mockVerifyBearer.mockResolvedValue("u2");
    expect(await verifyCollabToken("ba-tok")).toEqual({ sub: "u2" });
    expect(mockVerifyBearer).toHaveBeenCalledWith("ba-tok");
  });

  it("throws Invalid session when neither backend accepts the token", async () => {
    mockLookupSession.mockResolvedValue(null);
    mockVerifyBearer.mockResolvedValue(null);
    await expect(verifyCollabToken("nope")).rejects.toThrow("Invalid session");
  });

  it("degrades a BetterAuth fault to Invalid session rather than a 500", async () => {
    mockLookupSession.mockResolvedValue(null);
    mockVerifyBearer.mockRejectedValue(new Error("boom"));
    await expect(verifyCollabToken("x")).rejects.toThrow("Invalid session");
  });
});
