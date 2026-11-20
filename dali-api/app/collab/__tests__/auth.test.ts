import { describe, it, expect, beforeEach, vi } from "vitest";

const mockVerifyBearer = vi.hoisted(() => vi.fn());
const mockSessionFindUnique = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({
  prisma: { session: { findUnique: mockSessionFindUnique } },
}));
vi.mock("~/lib/betterauth-compat.server", () => ({
  verifyBetterAuthBearerToken: mockVerifyBearer,
}));

import { verifyCollabToken } from "~/collab/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyCollabToken", () => {
  it("accepts a BetterAuth bearer token", async () => {
    mockVerifyBearer.mockResolvedValue("u2");
    expect(await verifyCollabToken("ba-tok")).toEqual({ sub: "u2" });
    expect(mockVerifyBearer).toHaveBeenCalledWith("ba-tok");
  });

  it("rejects a legacy session id without querying the legacy table", async () => {
    mockVerifyBearer.mockResolvedValue(null);
    await expect(verifyCollabToken("legacy-sid")).rejects.toThrow("Invalid session");
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  it("degrades a BetterAuth fault to Invalid session rather than a 500", async () => {
    mockVerifyBearer.mockRejectedValue(new Error("boom"));
    await expect(verifyCollabToken("x")).rejects.toThrow("Invalid session");
  });
});
