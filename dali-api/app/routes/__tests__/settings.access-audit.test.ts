import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302 })),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { action as sessionsAction } from "~/routes/settings.sessions";
import { action as connectedAppsAction } from "~/routes/settings.connected-apps";
import { action as oauthRevokeAction } from "~/routes/oauth.revoke";

const mockPrisma = prisma as any;

function post(url: string, body: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, v);
  return { request: new Request(url, { method: "POST", body: fd }), params: {}, context: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1" },
    sessionId: "current",
  } as any);
  mockPrisma.authSession = {
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(null),
  };
  mockPrisma.session = {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  };
  mockPrisma.oAuthGrant = { findUnique: vi.fn(), update: vi.fn() };
});

describe("settings.sessions audit", () => {
  it("revoke-one logs scope and count without the session id", async () => {
    await sessionsAction(
      post("http://x/settings/sessions", { intent: "revoke-one", sessionId: "secret-sid" }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.revoke",
        userId: "u1",
        metadata: { scope: "one", count: 1 },
      }),
    );
    expect(JSON.stringify(vi.mocked(logAuditEvent).mock.calls)).not.toContain("secret-sid");
  });

  it("revoke-others ends the other BetterAuth sessions and logs the count", async () => {
    mockPrisma.authSession.deleteMany.mockResolvedValue({ count: 2 });
    await sessionsAction(post("http://x/settings/sessions", { intent: "revoke-others" }));
    expect(mockPrisma.authSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", NOT: { id: "current" } },
    });
    expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.revoke",
        metadata: { scope: "others", count: 2 },
      }),
    );
  });

  it("does not log when nothing was revoked", async () => {
    mockPrisma.authSession.deleteMany.mockResolvedValue({ count: 0 });
    await sessionsAction(post("http://x/settings/sessions", { intent: "revoke-others" }));
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("settings.connected-apps audit", () => {
  it("logs oauth.grant.revoke with client details", async () => {
    mockPrisma.oAuthGrant.findUnique.mockResolvedValue({
      id: "g1",
      userId: "u1",
      clientId: "c1",
      name: "Claude",
    });
    await connectedAppsAction(post("http://x/settings/connected-apps", { grantId: "g1" }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "oauth.grant.revoke",
        userId: "u1",
        targetId: "g1",
        metadata: { clientId: "c1", clientName: "Claude" },
      }),
    );
  });

  it("does not log for someone else's grant", async () => {
    mockPrisma.oAuthGrant.findUnique.mockResolvedValue({ id: "g1", userId: "other" });
    await connectedAppsAction(post("http://x/settings/connected-apps", { grantId: "g1" }));
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("oauth.revoke audit", () => {
  it("logs session.revoke for a live token without recording the token", async () => {
    mockPrisma.authSession.findUnique.mockResolvedValue({
      id: "a1",
      userId: "u1",
      grantId: "g1",
    });
    await oauthRevokeAction(post("http://x/oauth/revoke", { token: "raw-token" }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.revoke",
        userId: "u1",
        metadata: { scope: "one", count: 1, via: "oauth.revoke", grantId: "g1" },
      }),
    );
    expect(JSON.stringify(vi.mocked(logAuditEvent).mock.calls)).not.toContain("raw-token");
  });

  it("does not log for an unknown token", async () => {
    await oauthRevokeAction(post("http://x/oauth/revoke", { token: "t" }));
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
  });
});
