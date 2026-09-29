// The collab-specific BetterAuth helpers: minting the live session's bearer
// token for the WS handshake, and validating a bearer token the collab server
// receives. getSession is mocked (same style as mcp-auth.betterauth.test.ts).

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import {
  getBetterAuthCollabToken,
  verifyBetterAuthBearerToken,
} from "~/lib/betterauth-compat.server";

beforeEach(() => vi.clearAllMocks());

describe("getBetterAuthCollabToken", () => {
  it("returns the live session's raw token", async () => {
    mockGetSession.mockResolvedValue({
      session: { token: "sess-tok" },
      user: { id: "u1" },
    });
    const req = new Request("http://x", {
      headers: { cookie: "dali.session_token=abc" },
    });
    expect(await getBetterAuthCollabToken(req)).toBe("sess-tok");
    expect(mockGetSession).toHaveBeenCalledWith({ headers: req.headers });
  });

  it("returns null when there is no BetterAuth session", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await getBetterAuthCollabToken(new Request("http://x"))).toBeNull();
  });
});

describe("verifyBetterAuthBearerToken", () => {
  it("validates via an Authorization: Bearer header and returns the userId", async () => {
    mockGetSession.mockResolvedValue({
      session: { token: "t" },
      user: { id: "u2" },
    });
    expect(await verifyBetterAuthBearerToken("raw-tok")).toBe("u2");
    const arg = mockGetSession.mock.calls[0][0] as { headers: Headers };
    expect(arg.headers.get("authorization")).toBe("Bearer raw-tok");
  });

  it("returns null for an empty token without calling getSession", async () => {
    expect(await verifyBetterAuthBearerToken("")).toBeNull();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("returns null when getSession rejects the token", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await verifyBetterAuthBearerToken("bad")).toBeNull();
  });
});
