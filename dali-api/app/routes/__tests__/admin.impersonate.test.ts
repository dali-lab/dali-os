// Tests for POST /admin/impersonate
// Mocks: ~/lib/db.server, ~/lib/roles (isAdmin), ~/lib/betterauth-compat.server
// (getBetterAuthUser), ~/lib/betterauth.server (auth.api.impersonateUser),
// ~/lib/audit.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/betterauth-compat.server", () => ({
  getBetterAuthUser: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isAdmin: vi.fn(),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    api: {
      impersonateUser: vi.fn(),
    },
  },
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/routes/admin.impersonate";

const mockGetUser = getBetterAuthUser as unknown as ReturnType<typeof vi.fn>;
const mockIsAdmin = isAdmin as unknown as ReturnType<typeof vi.fn>;
const mockImpersonate = (auth.api.impersonateUser as unknown) as ReturnType<typeof vi.fn>;
const mockLogAudit = logAuditEvent as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const ACTOR_ID = "admin-user-1";
const TARGET_ID = "target-user-2";

function makeRequest(body: Record<string, string> = { userId: TARGET_ID }, referer?: string): Request {
  const formData = new FormData();
  for (const [k, v] of Object.entries(body)) {
    formData.append(k, v);
  }
  return new Request("http://localhost/admin/impersonate", {
    method: "POST",
    body: formData,
    headers: referer ? { Referer: referer } : {},
  });
}

const location = (res: Response) => res.headers.get("Location");

// Default impersonateUser mock returns a Headers with a Set-Cookie.
function makeImpersonateHeaders(cookie = "dali.session=impersonate-token; Path=/; HttpOnly"): Headers {
  const h = new Headers();
  h.append("set-cookie", cookie);
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: valid admin session.
  mockGetUser.mockResolvedValue({ sub: ACTOR_ID, email: "admin@dali.edu", type: "member" });

  // Default: is admin.
  mockIsAdmin.mockResolvedValue(true);

  // findUnique serves both the target-exists check and the actor role read.
  // Default: the target exists and the actor already has role="admin" (no JIT
  // update needed).
  mockPrisma.user.findUnique = vi.fn().mockResolvedValue({ id: TARGET_ID, role: "admin" });
  mockPrisma.user.update = vi.fn().mockResolvedValue({});

  // Default: impersonation succeeds.
  mockImpersonate.mockResolvedValue({
    headers: makeImpersonateHeaders(),
    response: { session: {}, user: {} },
  });

  // Default: audit log is a no-op.
  mockLogAudit.mockResolvedValue(undefined);
});

describe("POST /admin/impersonate — session gate", () => {
  it("sends a signed-out request to login", async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/login");
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — admin gate", () => {
  it("sends a non-admin home", async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/");
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — input validation", () => {
  it("returns to site users with an error when userId is missing", async () => {
    const res = await action({ request: makeRequest({}) } as any);
    expect(location(res)).toBe("/admin/site-users?impersonateError=missing");
    expect(mockImpersonate).not.toHaveBeenCalled();
  });

  it("returns to site users with an error on self-impersonation", async () => {
    const res = await action({ request: makeRequest({ userId: ACTOR_ID }) } as any);
    expect(location(res)).toBe("/admin/site-users?impersonateError=self");
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — target existence", () => {
  it("returns to site users with an error when the target user does not exist", async () => {
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);
    const res = await action({ request: makeRequest() } as any);
    expect(location(res)).toBe("/admin/site-users?impersonateError=missing");
    expect(mockImpersonate).not.toHaveBeenCalled();
  });

  it("impersonates a non-member target — any real user is allowed", async () => {
    // No membership gate anymore: every shell an impersonated user can land in
    // mounts the stop-impersonating banner, so non-members are fine.
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue({ id: TARGET_ID, role: "admin" });
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(302);
    expect(mockImpersonate).toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — JIT role sync", () => {
  it("calls user.update with role:'admin' when actor role is stale", async () => {
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue({ role: "user" });
    const res = await action({ request: makeRequest() } as any);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: ACTOR_ID },
      data: { role: "admin" },
    });
    // Should still proceed to impersonate.
    expect(mockImpersonate).toHaveBeenCalled();
    // Should redirect (302).
    expect(res.status).toBe(302);
  });

  it("does NOT call user.update when actor role is already 'admin'", async () => {
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue({ role: "admin" });
    const res = await action({ request: makeRequest() } as any);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockImpersonate).toHaveBeenCalled();
    expect(res.status).toBe(302);
  });
});

describe("POST /admin/impersonate — happy path", () => {
  it("calls impersonateUser with the target userId and request headers", async () => {
    await action({ request: makeRequest() } as any);

    expect(mockImpersonate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { userId: TARGET_ID },
        returnHeaders: true,
      }),
    );
  });

  it("logs the audit event with actor sub and target userId", async () => {
    await action({ request: makeRequest() } as any);

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.impersonate.start",
        userId: ACTOR_ID,
        targetId: TARGET_ID,
        metadata: expect.objectContaining({ targetUserId: TARGET_ID }),
      }),
    );
  });

  it("returns a redirect carrying the forwarded Set-Cookie from BetterAuth", async () => {
    const cookie = "dali.session=abc123; Path=/; HttpOnly; SameSite=Lax";
    mockImpersonate.mockResolvedValue({
      headers: makeImpersonateHeaders(cookie),
      response: {},
    });

    const res = await action({ request: makeRequest() } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    // The Set-Cookie forwarded from BetterAuth must appear on the response.
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("dali.session=abc123");
  });

  it("returns to site users with an error when impersonateUser throws", async () => {
    mockImpersonate.mockRejectedValue(new Error("plugin error"));
    const res = await action({ request: makeRequest() } as any);
    expect(location(res)).toBe("/admin/site-users?impersonateError=failed");
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("keeps the admin's search and filter when returning with an error", async () => {
    mockImpersonate.mockRejectedValue(new Error("plugin error"));
    const res = await action({
      request: makeRequest({ userId: TARGET_ID }, "http://localhost/admin/site-users?q=ada&kind=Member"),
    } as any);
    expect(location(res)).toBe("/admin/site-users?q=ada&kind=Member&impersonateError=failed");
  });

  it.each(["https://evil.example/admin/site-users?q=x", "http://localhost/admin/members?q=x", "not a url"])(
    "ignores a Referer of %s",
    async (referer) => {
      mockImpersonate.mockRejectedValue(new Error("plugin error"));
      const res = await action({ request: makeRequest({ userId: TARGET_ID }, referer) } as any);
      expect(location(res)).toBe("/admin/site-users?impersonateError=failed");
    },
  );
});
