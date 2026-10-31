import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/oauth", () => ({
  exchangeAuthorizationCode: vi.fn(),
  buildUserInfo: vi.fn(() => ({})),
  getOAuthClient: vi.fn(),
  OAuthError: class OAuthError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
    toJSON() {
      return { error: this.code };
    }
  },
}));
vi.mock("~/lib/request-meta", () => ({ getClientIp: vi.fn(() => "1.1.1.1") }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  preflightLoader: vi.fn(),
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: () => null }));
vi.mock("~/lib/betterauth-session.server", () => ({ mintBetterAuthSession: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { exchangeAuthorizationCode, getOAuthClient } from "~/lib/oauth";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/routes/oauth.token";

const mockPrisma = prisma as any;

function tokenRequest(body: Record<string, string>) {
  return {
    request: new Request("http://x/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
    userId: "u1",
    provider: "google",
    accountType: "member",
    scopes: ["mcp:read", "mcp:admin"],
    clientId: "c1",
  } as any);
  vi.mocked(getOAuthClient).mockResolvedValue({ clientId: "c1", name: "Claude" } as any);
  vi.mocked(mintBetterAuthSession).mockResolvedValue({
    token: "raw",
    sessionId: "s1",
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ id: "u1" }) };
  mockPrisma.oAuthGrant = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: "g1" }),
  };
});

describe("oauth.token audit", () => {
  it("logs oauth.grant.issue on the authorization_code exchange, without secrets", async () => {
    await action(
      tokenRequest({
        grant_type: "authorization_code",
        code: "the-code",
        code_verifier: "the-verifier",
        redirect_uri: "http://cb",
        client_id: "c1",
      }),
    );
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "oauth.grant.issue",
        userId: "u1",
        targetId: "g1",
        metadata: { clientId: "c1", clientName: "Claude", scope: "mcp:read mcp:admin" },
      }),
    );
    const logged = JSON.stringify(vi.mocked(logAuditEvent).mock.calls);
    for (const secret of ["the-code", "the-verifier", "raw"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("does not log an unsupported grant type or a failed exchange", async () => {
    await action(tokenRequest({ grant_type: "refresh_token" }));
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
