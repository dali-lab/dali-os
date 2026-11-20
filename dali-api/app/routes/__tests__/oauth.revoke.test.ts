import { describe, it, expect, beforeEach, vi } from "vitest";

const mockAudit = vi.hoisted(() => vi.fn());
vi.mock("~/lib/audit", () => ({ logAuditEvent: mockAudit }));
vi.mock("~/lib/db.server", () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    authSession: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
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

  it("does not touch the legacy session table for an opaque token", async () => {
    await action({ request: revoke("legacy-token") } as any);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns 200 without auditing an unknown token", async () => {
    const res = (await action({ request: revoke("old") } as any)) as Response;

    expect(res.status).toBe(200);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
