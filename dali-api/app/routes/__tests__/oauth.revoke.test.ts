import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRevokeSession = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session", () => ({
  revokeSession: mockRevokeSession,
  hashSessionId: (raw: string) => `hash:${raw}`,
}));
const mockAudit = vi.hoisted(() => vi.fn());
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockAudit }));
vi.mock("~/lib/db", () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    authSession: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { action } from "~/routes/oauth.revoke";

function revoke(token: string) {
  return new Request("http://localhost/oauth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.session.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.authSession.findUnique).mockResolvedValue(null);
});

describe("POST /oauth/revoke", () => {
  it("deletes a BetterAuth MCP session for the token and audits it", async () => {
    vi.mocked(prisma.authSession.findUnique).mockResolvedValue({
      id: "ba-1",
      userId: "user-1",
      grantId: "grant-1",
    } as any);

    const res = (await action({ request: revoke("ba-token") } as any)) as Response;

    expect(res.status).toBe(200);
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith({
      where: { token: "ba-token" },
      select: { id: true, userId: true, grantId: true },
    });
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({ where: { id: "ba-1" } });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session.revoke",
        userId: "user-1",
        metadata: expect.objectContaining({ via: "oauth.revoke", grantId: "grant-1" }),
      }),
    );
  });

  it("still revokes a legacy session", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      userId: "user-1",
      grantId: "grant-1",
      revokedAt: null,
    } as any);

    await action({ request: revoke("legacy-token") } as any);

    expect(mockRevokeSession).toHaveBeenCalledWith("legacy-token");
    expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it("returns 200 without auditing an unknown or already revoked token", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      userId: "user-1",
      grantId: null,
      revokedAt: new Date(),
    } as any);

    const res = (await action({ request: revoke("old") } as any)) as Response;

    expect(res.status).toBe(200);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
