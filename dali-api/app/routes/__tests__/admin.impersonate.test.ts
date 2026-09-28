// Tests for POST /admin/impersonate
// Mocks: ~/lib/db, ~/lib/roles (isAdmin), ~/lib/betterauth-compat.server
// (getBetterAuthUser), ~/lib/betterauth.server (auth.api.impersonateUser),
// ~/lib/feature-flags.server (isFeatureEnabledForEveryone), ~/lib/audit.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: vi.fn(),
}));
vi.mock("~/lib/betterauth-compat.server", () => ({
  getBetterAuthUser: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isAdmin: vi.fn(),
}));
vi.mock("~/lib/db");
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

import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { isAdmin } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { auth } from "~/lib/betterauth.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/routes/admin.impersonate";

const mockFlagOn = isFeatureEnabledForEveryone as unknown as ReturnType<typeof vi.fn>;
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

function makeRequest(body: Record<string, string> = { userId: TARGET_ID }): Request {
  const formData = new FormData();
  for (const [k, v] of Object.entries(body)) {
    formData.append(k, v);
  }
  return new Request("http://localhost/admin/impersonate", {
    method: "POST",
    body: formData,
  });
}

// Default impersonateUser mock returns a Headers with a Set-Cookie.
function makeImpersonateHeaders(cookie = "dali.session=impersonate-token; Path=/; HttpOnly"): Headers {
  const h = new Headers();
  h.append("set-cookie", cookie);
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: flag on.
  mockFlagOn.mockResolvedValue(true);

  // Default: valid admin session.
  mockGetUser.mockResolvedValue({ sub: ACTOR_ID, email: "admin@dali.edu", type: "member" });

  // Default: is admin.
  mockIsAdmin.mockResolvedValue(true);

  // Default: actor already has role="admin" (no JIT update needed).
  mockPrisma.user.findUnique = vi.fn().mockResolvedValue({ role: "admin" });
  mockPrisma.user.update = vi.fn().mockResolvedValue({});

  // Default: impersonation succeeds.
  mockImpersonate.mockResolvedValue({
    headers: makeImpersonateHeaders(),
    response: { session: {}, user: {} },
  });

  // Default: audit log is a no-op.
  mockLogAudit.mockResolvedValue(undefined);
});

describe("POST /admin/impersonate — flag gate", () => {
  it("returns 404 when betterauth flag is off", async () => {
    mockFlagOn.mockResolvedValue(false);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(404);
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — session gate", () => {
  it("returns 401 when there is no session", async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(401);
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — admin gate", () => {
  it("returns 403 when session exists but user is not admin", async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(403);
    expect(mockImpersonate).not.toHaveBeenCalled();
  });
});

describe("POST /admin/impersonate — input validation", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await action({ request: makeRequest({}) } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Missing userId/i);
    expect(mockImpersonate).not.toHaveBeenCalled();
  });

  it("returns 400 when target userId equals actor (self-impersonation)", async () => {
    const res = await action({ request: makeRequest({ userId: ACTOR_ID }) } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot impersonate self/i);
    expect(mockImpersonate).not.toHaveBeenCalled();
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

  it("returns 400 when impersonateUser throws", async () => {
    mockImpersonate.mockRejectedValue(new Error("plugin error"));
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
