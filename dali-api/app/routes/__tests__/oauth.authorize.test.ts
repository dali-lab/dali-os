import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetOAuthClient = vi.hoisted(() => vi.fn());

vi.mock("~/lib/oauth", () => ({
  createOAuthSession: vi.fn().mockResolvedValue({ id: "session-1" }),
  getOAuthClient: mockGetOAuthClient,
  isAllowedRedirectUri: (_client: any, uri: string) =>
    uri === "http://localhost:5173/login",
  generateAuthorizationCode: vi.fn(),
  OAuthError: class OAuthError extends Error {},
}));

vi.mock("~/lib/cookies", () => ({
  parseSessionId: vi.fn().mockReturnValue(null),
}));
vi.mock("~/lib/session", () => ({
  lookupSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/db", () => ({
  prisma: {
    dALIMember: { findUnique: vi.fn() },
    oAuthGrant: { findUnique: vi.fn() },
    oAuthSession: { update: vi.fn() },
  },
}));

import { _resetForTests } from "~/lib/rate-limit";
import { loader } from "~/routes/oauth.authorize";

function makeRequest(ip = "1.2.3.4") {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "dali-api",
    redirect_uri: "http://localhost:5173/login",
    state: "xyz",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    provider: "google",
    account_type: "member",
  });
  return new Request(`http://localhost/oauth/authorize?${params}`, {
    headers: { "X-Forwarded-For": ip },
  });
}

beforeEach(() => {
  _resetForTests();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.API_BASE_URL = "http://localhost:3001";
  process.env.FRONTEND_URL = "http://localhost:5173";
  mockGetOAuthClient.mockResolvedValue({
    clientId: "dali-api",
    name: "Dali API",
    redirectUris: ["http://localhost:5173/login"],
    isLoopback: false,
    isFirstParty: false,
    allowedScopes: ["mcp:read", "mcp:write"],
    allowedProviders: ["google", "cas"],
    requiredAccountType: "member",
    requireMembership: false,
  });
});

describe("GET /oauth/authorize rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await loader({ request: makeRequest() } as any);
      expect(res.status).toBe(302);
    }
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 10; i++) {
      await loader({ request: makeRequest() } as any);
    }
    const res = await loader({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per IP", async () => {
    for (let i = 0; i < 10; i++) {
      await loader({ request: makeRequest("1.2.3.4") } as any);
    }
    const limited = await loader({ request: makeRequest("1.2.3.4") } as any);
    expect(limited.status).toBe(429);

    const ok = await loader({ request: makeRequest("5.6.7.8") } as any);
    expect(ok.status).toBe(302);
  });
});
