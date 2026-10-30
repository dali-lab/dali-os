import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
vi.mock("~/lib/auth", () => ({
  requireAuth: mockRequireAuth,
  isImpersonating: (auth: { impersonatedBy?: string }) => auth.impersonatedBy != null,
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isAdmin: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/oauth", () => ({
  getOAuthClient: vi.fn().mockResolvedValue({ clientId: "c1", name: "Claude Code" }),
  generateAuthorizationCode: vi.fn().mockResolvedValue("code-1"),
  authorizationResponseUrl: ({ redirectUri, query }: any) =>
    `${redirectUri}?${new URLSearchParams(
      Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>,
    )}`,
}));
vi.mock("~/lib/db.server", () => ({
  prisma: {
    oAuthSession: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    oAuthGrant: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import { action, loader } from "~/routes/oauth.consent";

const OAUTH_SESSION = {
  id: "os-1",
  userId: "user-1",
  clientId: "c1",
  scopes: ["mcp:read"],
  redirectUri: "http://127.0.0.1:5000/callback",
  state: "st",
  exchanged: false,
  expiresAt: new Date(Date.now() + 60_000),
};

function signedInAs(sub: string, extra: Record<string, unknown> = {}) {
  mockRequireAuth.mockResolvedValue({ ok: true, user: { sub }, sessionId: "s", ...extra });
}

function consentPost(decision = "approve") {
  return new Request("http://localhost/oauth/consent", {
    method: "POST",
    body: new URLSearchParams({ session_id: "os-1", decision }),
  });
}

const loaderRequest = () => new Request("http://localhost/oauth/consent?session_id=os-1");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.oAuthSession.findUnique).mockResolvedValue(OAUTH_SESSION as any);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    daliEmail: "ada@dali.dartmouth.edu",
    dartmouthEmail: null,
    netId: null,
  } as any);
  vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue(null);
  signedInAs("user-1");
});

describe("GET /oauth/consent", () => {
  it("renders for the signed-in user the request belongs to", async () => {
    const data = await loader({ request: loaderRequest() } as any);
    expect(data).toMatchObject({ ok: true, clientName: "Claude Code", scopes: ["mcp:read"] });
  });

  it("refuses a signed-out browser", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false });
    expect(await loader({ request: loaderRequest() } as any)).toEqual({
      ok: false,
      error: "You must be signed in to authorize this app",
    });
  });

  it("refuses a different signed-in user", async () => {
    signedInAs("user-2");
    expect(await loader({ request: loaderRequest() } as any)).toEqual({
      ok: false,
      error: "Session mismatch",
    });
  });

  it("refuses an impersonated session even for the right user", async () => {
    signedInAs("user-1", { impersonatedBy: "admin-1" });
    const data = await loader({ request: loaderRequest() } as any);
    expect(data).toMatchObject({ ok: false });
  });
});

describe("POST /oauth/consent", () => {
  it("approves: records the grant and redirects to the client with a code", async () => {
    const res = (await action({ request: consentPost() } as any)) as Response;
    expect(res.headers.get("location")).toBe("http://127.0.0.1:5000/callback?code=code-1&state=st");
    expect(prisma.oAuthGrant.upsert).toHaveBeenCalled();
  });

  it("does not grant for a signed-out browser", async () => {
    mockRequireAuth.mockResolvedValue({ ok: false });
    const res = (await action({ request: consentPost() } as any)) as Response;
    expect(res.headers.get("location")).toBe("/login?error=consent_unauthenticated");
    expect(prisma.oAuthGrant.upsert).not.toHaveBeenCalled();
  });

  it("does not grant for a different user", async () => {
    signedInAs("user-2");
    const res = (await action({ request: consentPost() } as any)) as Response;
    expect(res.headers.get("location")).toBe("/login?error=consent_mismatch");
    expect(prisma.oAuthGrant.upsert).not.toHaveBeenCalled();
  });

  it("does not grant for an impersonated session", async () => {
    signedInAs("user-1", { impersonatedBy: "admin-1" });
    const res = (await action({ request: consentPost() } as any)) as Response;
    expect(res.headers.get("location")).toBe("/login?error=consent_mismatch");
    expect(prisma.oAuthGrant.upsert).not.toHaveBeenCalled();
  });
});
