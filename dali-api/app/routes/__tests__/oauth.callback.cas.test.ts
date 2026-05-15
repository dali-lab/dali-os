import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetOAuthSession = vi.hoisted(() => vi.fn());
const mockGetOAuthClient = vi.hoisted(() => vi.fn());
const mockGenerateAuthorizationCode = vi.hoisted(() => vi.fn());
const mockValidateCasTicket = vi.hoisted(() => vi.fn());
const mockUpsertUserFromCas = vi.hoisted(() => vi.fn());
const mockIssueSession = vi.hoisted(() => vi.fn());

vi.mock("~/lib/oauth", () => ({
  getOAuthSession: mockGetOAuthSession,
  getOAuthClient: mockGetOAuthClient,
  generateAuthorizationCode: mockGenerateAuthorizationCode,
}));

vi.mock("~/lib/auth", () => ({
  validateCasTicket: mockValidateCasTicket,
}));

vi.mock("~/lib/user-provisioning", () => ({
  upsertUserFromCas: mockUpsertUserFromCas,
}));

vi.mock("~/lib/session", () => ({
  issueSession: mockIssueSession,
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    oAuthGrant: { findUnique: vi.fn().mockResolvedValue(null) },
    oAuthSession: { update: vi.fn().mockResolvedValue({}) },
  },
}));

import { loader } from "~/routes/oauth.callback.cas";

function makeRequest(sessionId: string, ticket = "cas-ticket") {
  const params = new URLSearchParams({ ticket, session_id: sessionId });
  return new Request(`http://localhost/oauth/callback/cas?${params}`, {
    headers: { "user-agent": "test-agent", "X-Forwarded-For": "9.8.7.6" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.API_BASE_URL = "http://localhost:3001";

  mockGetOAuthSession.mockResolvedValue({
    id: "sess-1",
    state: "client-state",
    redirectUri: "http://127.0.0.1:51999/callback",
    expiresAt: new Date(Date.now() + 60_000),
    exchanged: false,
    accountType: "member",
    clientId: "client-1",
    scopes: ["mcp:read"],
    linkUserId: null,
  });
  mockValidateCasTicket.mockResolvedValue({
    netId: "abc123",
  });
  mockUpsertUserFromCas.mockResolvedValue({
    user: { id: "user-1", netId: "abc123" },
  });
  mockIssueSession.mockResolvedValue({
    rawId: "raw-session-id",
    expiresAt: new Date(Date.now() + 1_000_000),
    absoluteExpiresAt: new Date(Date.now() + 1_000_000),
  });
});

describe("GET /oauth/callback/cas sets __dali_sid cookie", () => {
  it("issues cookie session when redirecting to consent screen", async () => {
    mockGetOAuthClient.mockResolvedValue({
      clientId: "client-1",
      name: "Some App",
      isFirstParty: false,
    });

    const res = await loader({ request: makeRequest("sess-1") } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/oauth/consent?session_id=sess-1",
    );

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__dali_sid=raw-session-id");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    expect(mockIssueSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", ip: "9.8.7.6" }),
    );
    expect(mockIssueSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ grantId: expect.anything() }),
    );
  });

  it("issues cookie session on direct loopback redirect (first-party client)", async () => {
    mockGetOAuthClient.mockResolvedValue({
      clientId: "client-1",
      name: "Some App",
      isFirstParty: true,
    });
    mockGenerateAuthorizationCode.mockResolvedValue("auth-code-xyz");

    const res = await loader({ request: makeRequest("sess-1") } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(
      "http://127.0.0.1:51999/callback",
    );
    expect(res.headers.get("Location")).toContain("code=auth-code-xyz");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__dali_sid=raw-session-id");
  });
});
