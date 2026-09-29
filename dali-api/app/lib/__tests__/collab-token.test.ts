// getCollabToken picks the credential a route loader hands to the collab client:
// the legacy __dali_sid cookie when present, otherwise the BetterAuth session
// token — and never throws on a BetterAuth fault.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetBaCollab = vi.hoisted(() => vi.fn());

vi.mock("~/lib/betterauth-compat.server", () => ({
  getBetterAuthCollabToken: mockGetBaCollab,
}));

import { getCollabToken } from "~/lib/collab-token.server";

const withSid = (sid: string) =>
  new Request("http://x", { headers: { cookie: `__dali_sid=${sid}` } });

beforeEach(() => vi.clearAllMocks());

describe("getCollabToken", () => {
  it("returns the legacy __dali_sid cookie without touching BetterAuth", async () => {
    expect(await getCollabToken(withSid("legacy-tok"))).toBe("legacy-tok");
    expect(mockGetBaCollab).not.toHaveBeenCalled();
  });

  it("falls back to the BetterAuth session token when no legacy cookie is present", async () => {
    mockGetBaCollab.mockResolvedValue("ba-sess-tok");
    expect(await getCollabToken(new Request("http://x"))).toBe("ba-sess-tok");
  });

  it("returns null rather than throwing when BetterAuth resolution faults", async () => {
    mockGetBaCollab.mockRejectedValue(new Error("boom"));
    expect(await getCollabToken(new Request("http://x"))).toBeNull();
  });

  it("returns null when neither backend has a session", async () => {
    mockGetBaCollab.mockResolvedValue(null);
    expect(await getCollabToken(new Request("http://x"))).toBeNull();
  });
});
