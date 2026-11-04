import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
vi.mock("~/lib/auth", () => ({ requireAuth: mockRequireAuth }));
const mockRevokeAllForGrant = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session", () => ({ revokeAllForGrant: mockRevokeAllForGrant }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/db.server", () => ({
  prisma: {
    oAuthGrant: { findUnique: vi.fn(), update: vi.fn() },
    authSession: { deleteMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import { action } from "~/routes/settings.connected-apps";

function revoke(grantId: string) {
  return new Request("http://localhost/settings/connected-apps", {
    method: "POST",
    body: new URLSearchParams({ grantId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ ok: true, user: { sub: "user-1" }, sessionId: "s" });
});

describe("POST /settings/connected-apps", () => {
  it("revokes the grant and deletes its sessions in both stores", async () => {
    vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue({
      id: "grant-1",
      userId: "user-1",
      clientId: "c1",
      name: "Claude Code",
    } as any);

    await action({ request: revoke("grant-1") } as any);

    expect(prisma.oAuthGrant.update).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockRevokeAllForGrant).toHaveBeenCalledWith("grant-1");
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({ where: { grantId: "grant-1" } });
  });

  it("does nothing for someone else's grant", async () => {
    vi.mocked(prisma.oAuthGrant.findUnique).mockResolvedValue({
      id: "grant-2",
      userId: "user-2",
    } as any);

    await action({ request: revoke("grant-2") } as any);

    expect(prisma.oAuthGrant.update).not.toHaveBeenCalled();
    expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
  });
});
