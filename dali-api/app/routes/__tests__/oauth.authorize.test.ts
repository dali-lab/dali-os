import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetOAuthClient = vi.hoisted(() => vi.fn());

vi.mock("~/lib/oauth", async () => ({
  // authorizationResponseUrl is a pure URL builder — use the real one so these
  // tests see the same `iss` the route actually emits.
  authorizationResponseUrl: (
    await vi.importActual<typeof import("~/lib/oauth")>("~/lib/oauth")
  ).authorizationResponseUrl,
  createOAuthSession: vi.fn().mockResolvedValue({ id: "session-1" }),
  getOAuthClient: mockGetOAuthClient,
  isAllowedRedirectUri: (_client: any, uri: string) =>
    uri === "http://localhost:5173/login",
  generateAuthorizationCode: vi.fn().mockResolvedValue("code-1"),
  OAuthError: class OAuthError extends Error {},
}));

const mockRequireAuth = vi.hoisted(() => vi.fn());
vi.mock("~/lib/auth", () => ({
  requireAuth: mockRequireAuth,
  isImpersonating: (auth: { impersonatedBy?: string }) => auth.impersonatedBy != null,
}));
vi.mock("~/lib/db.server", () => ({
  prisma: {
    dALIMember: { findUnique: vi.fn() },
    oAuthGrant: { findUnique: vi.fn() },
    oAuthSession: { update: vi.fn() },
  },
}));

import { _resetForTests } from "~/lib/rate-limit";
import { createOAuthSession, generateAuthorizationCode } from "~/lib/oauth";
import { prisma } from "~/lib/db.server";
import { loader } from "~/routes/oauth.authorize";

function makeRequest(ip = "1.2.3.4", scope?: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "dali-api",
    redirect_uri: "http://localhost:5173/login",
    state: "xyz",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    provider: "google",
    account_type: "member",
    ...(scope ? { scope } : {}),
  });
  return new Request(`http://localhost/oauth/authorize?${params}`, {
    headers: { "X-Forwarded-For": ip },
  });
}

function signedIn(extra: Record<string, unknown> = {}) {
  mockRequireAuth.mockResolvedValue({
    ok: true,
    user: { sub: "user-1", email: "ada@dali.dartmouth.edu", type: "member" },
    sessionId: "s1",
    ...extra,
  });
}

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
  vi.mocked(createOAuthSession).mockResolvedValue({ id: "session-1" } as any);
  vi.mocked(generateAuthorizationCode).mockResolvedValue("code-1");
  vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue(null);
  signedIn();
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

describe("GET /oauth/authorize scopes", () => {
  // The metadata advertises mcp:admin, so connectors ask for it — including
  // ones registered before it existed, whose allowedScopes lack it.
  it("drops mcp:admin for a client registered before it existed", async () => {
    const res = await loader({ request: makeRequest("9.9.9.1", "mcp:read mcp:write mcp:admin") } as any);
    expect(res.headers.get("location") ?? "").not.toContain("invalid_scope");
    expect(vi.mocked(createOAuthSession)).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopes: ["mcp:read", "mcp:write"] }),
    );
  });

  it("keeps mcp:admin for a client that allows it (consent still role-gates it)", async () => {
    mockGetOAuthClient.mockResolvedValueOnce({
      ...(await mockGetOAuthClient()),
      allowedScopes: ["mcp:read", "mcp:write", "mcp:admin"],
    });
    await loader({ request: makeRequest("9.9.9.2", "mcp:read mcp:write mcp:admin") } as any);
    expect(vi.mocked(createOAuthSession)).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopes: ["mcp:read", "mcp:write", "mcp:admin"] }),
    );
  });

  it("still rejects any other scope the client isn't allowed", async () => {
    const res = await loader({ request: makeRequest("9.9.9.3", "mcp:read mcp:bogus") } as any);
    expect(res.headers.get("location") ?? "").toContain("invalid_scope");
  });
});

describe("GET /oauth/authorize sign-in", () => {
  it("sends a signed-out browser to /login and back to this exact authorize URL", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false });
    const request = makeRequest("9.9.7.1", "mcp:read");
    const res = await loader({ request } as any);
    expect(res.status).toBe(302);
    const url = new URL(request.url);
    expect(res.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
    );
    expect(createOAuthSession).not.toHaveBeenCalled();
  });

  it("never redirects to Google or CAS", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false });
    for (const provider of ["google", "cas"]) {
      const params = new URLSearchParams(new URL(makeRequest().url).search);
      params.set("provider", provider);
      const res = await loader({
        request: new Request(`http://localhost/oauth/authorize?${params}`, {
          headers: { "X-Forwarded-For": `9.9.7.${provider.length}` },
        }),
      } as any);
      expect(res.headers.get("location")).toMatch(/^\/login\?next=/);
    }
  });

  it("refuses an impersonated session with access_denied back to the client", async () => {
    signedIn({ impersonatedBy: "admin-1" });
    const res = await loader({ request: makeRequest("9.9.7.3", "mcp:read") } as any);
    const out = new URL(res.headers.get("location")!).searchParams;
    expect(out.get("error")).toBe("access_denied");
    expect(out.get("error_description")).toBe("impersonating");
    expect(createOAuthSession).not.toHaveBeenCalled();
  });

  it("refuses a non-member when the client requires membership", async () => {
    mockGetOAuthClient.mockResolvedValueOnce({
      ...(await mockGetOAuthClient()),
      requireMembership: true,
    });
    vi.mocked(prisma.dALIMember.findUnique).mockResolvedValue(null);
    const res = await loader({ request: makeRequest("9.9.7.4", "mcp:read") } as any);
    const out = new URL(res.headers.get("location")!).searchParams;
    expect(out.get("error")).toBe("access_denied");
    expect(out.get("error_description")).toBe("not_a_member");
  });

  it("sends a signed-in user with no grant to consent, bound to their user id", async () => {
    const res = await loader({ request: makeRequest("9.9.7.5", "mcp:read") } as any);
    expect(res.headers.get("location")).toBe("/oauth/consent?session_id=session-1");
    expect(prisma.oAuthSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { userId: "user-1" },
    });
  });

  it("issues a code straight away when an existing grant covers the scopes", async () => {
    vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue({
      revokedAt: null,
      scopes: ["mcp:read", "mcp:write"],
    } as any);
    const res = await loader({ request: makeRequest("9.9.7.6", "mcp:read") } as any);
    const out = new URL(res.headers.get("location")!);
    expect(out.origin + out.pathname).toBe("http://localhost:5173/login");
    expect(out.searchParams.get("code")).toBe("code-1");
    expect(out.searchParams.get("state")).toBe("xyz");
    expect(generateAuthorizationCode).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("goes to consent when the existing grant was revoked", async () => {
    vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue({
      revokedAt: new Date(),
      scopes: ["mcp:read"],
    } as any);
    const res = await loader({ request: makeRequest("9.9.7.7", "mcp:read") } as any);
    expect(res.headers.get("location")).toBe("/oauth/consent?session_id=session-1");
  });
});

// RFC 9207. ChatGPT reserves its stable connector callback for issuers that
// return `iss` on every authorization response, so a path that forgets it
// silently regresses us to per-connection callback ids.
describe("GET /oauth/authorize issuer identification", () => {
  function issOf(res: Response): string | null {
    return new URL(res.headers.get("location")!).searchParams.get("iss");
  }

  it("puts iss on an error response sent back to the client", async () => {
    const res = await loader({
      request: makeRequest("9.9.8.1", "mcp:read mcp:bogus"),
    } as any);
    expect(res.headers.get("location") ?? "").toContain("invalid_scope");
    expect(issOf(res)).toBe("http://localhost:3001");
  });

  it("keeps state alongside iss on an error response", async () => {
    const res = await loader({
      request: makeRequest("9.9.8.2", "mcp:read mcp:bogus"),
    } as any);
    const params = new URL(res.headers.get("location")!).searchParams;
    expect(params.get("state")).toBe("xyz");
    expect(params.get("iss")).toBe("http://localhost:3001");
  });

  it("omits state entirely when the request had none, but still sends iss", async () => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "dali-api",
      redirect_uri: "http://localhost:5173/login",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      provider: "google",
      account_type: "member",
    });
    const res = await loader({
      request: new Request(`http://localhost/oauth/authorize?${params}`, {
        headers: { "X-Forwarded-For": "9.9.8.3" },
      }),
    } as any);
    const out = new URL(res.headers.get("location")!).searchParams;
    expect(out.get("error")).toBe("invalid_request");
    expect(out.has("state")).toBe(false);
    expect(out.get("iss")).toBe("http://localhost:3001");
  });

  it("matches the issuer the metadata publishes", async () => {
    process.env.API_BASE_URL = "https://os.dali.dartmouth.edu/";
    const res = await loader({
      request: makeRequest("9.9.8.4", "mcp:read mcp:bogus"),
    } as any);
    const { loader: asLoader } = await import(
      "~/routes/well-known.oauth-authorization-server"
    );
    const metadata = await (
      await asLoader({
        request: new Request("https://os.dali.dartmouth.edu/.well-known/x"),
      } as any)
    ).json();
    expect(issOf(res)).toBe(metadata.issuer);
  });
});
