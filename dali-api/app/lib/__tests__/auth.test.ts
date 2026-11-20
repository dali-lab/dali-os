import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/betterauth-compat.server", () => ({
  resolveBetterAuthAuth: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { bumpLastActive, lastActiveThrottleSize, requireAuth, resetLastActiveThrottle } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { resolveBetterAuthAuth } from "~/lib/betterauth-compat.server";

const mockResolveBetterAuthAuth =
  resolveBetterAuthAuth as unknown as ReturnType<typeof vi.fn>;
const mockLogAuditEvent =
  logAuditEvent as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  session: Record<string, ReturnType<typeof vi.fn>>;
  $executeRaw: ReturnType<typeof vi.fn>;
};

// bumpLastActive is the only $executeRaw in this module, so its calls are the
// presence heartbeat. The user id is the single interpolated value.
function presenceBumpsFor(): string[] {
  return mockPrisma.$executeRaw.mock.calls.map((args: unknown[]) => String(args[1]));
}

function sessionQueries(): number {
  return Object.values(mockPrisma.session).reduce((n, fn) => n + fn.mock.calls.length, 0);
}

const BA_AUTH = {
  user: { sub: "ba-user", email: "ada@example.edu", type: "member" },
  sessionId: "auth-session-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLastActiveThrottle();
  mockPrisma.session = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  mockResolveBetterAuthAuth.mockResolvedValue(null);
});

describe("requireAuth", () => {
  it("returns no_session when there is no cookie and no header", async () => {
    const result = await requireAuth(new Request("http://localhost"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("authenticates a BetterAuth cookie session", async () => {
    mockResolveBetterAuthAuth.mockResolvedValue(BA_AUTH);
    const req = new Request("http://localhost", {
      headers: { Cookie: "dali.session_token=abc" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("ba-user");
      expect(result.sessionId).toBe("auth-session-1");
    }
  });

  it("authenticates a BetterAuth bearer token", async () => {
    mockResolveBetterAuthAuth.mockResolvedValue(BA_AUTH);
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer ba-token" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("no longer accepts a legacy __dali_sid cookie and never queries the legacy table", async () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
    expect(sessionQueries()).toBe(0);
  });

  it("no longer accepts a legacy opaque bearer and never queries the legacy table", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer legacy-opaque-id" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
      expect(result.response.status).toBe(401);
    }
    expect(sessionQueries()).toBe(0);
  });

  it("returns no_session when BetterAuth resolution throws and there is no credential", async () => {
    mockResolveBetterAuthAuth.mockRejectedValue(new Error("db down"));
    const result = await requireAuth(new Request("http://localhost"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
  });
});

describe("requireAuth — presence heartbeat", () => {
  it("bumps lastActiveAt for a BetterAuth session", async () => {
    mockResolveBetterAuthAuth.mockResolvedValue(BA_AUTH);
    const result = await requireAuth(new Request("http://localhost"));
    expect(result.ok).toBe(true);
    expect(presenceBumpsFor()).toEqual(["ba-user"]);
  });

  it("does NOT bump lastActiveAt while an admin is impersonating", async () => {
    mockResolveBetterAuthAuth.mockResolvedValue({
      user: { sub: "target-user", email: "ada@example.edu", type: "member" },
      sessionId: "auth-session-1",
      impersonatedBy: "admin-user",
    });
    const result = await requireAuth(new Request("http://localhost"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impersonatedBy).toBe("admin-user");
    expect(presenceBumpsFor()).toEqual([]);
  });
});

describe("bumpLastActive throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-02T12:00:00Z"), toFake: ["Date"] });
    mockPrisma.$executeRaw.mockResolvedValue(1);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes on the first call and skips repeats inside 60s", async () => {
    await bumpLastActive("ada");
    await bumpLastActive("ada");
    vi.advanceTimersByTime(59_999);
    await bumpLastActive("ada");
    expect(presenceBumpsFor()).toEqual(["ada"]);
  });

  it("writes again once 60s have passed", async () => {
    await bumpLastActive("ada");
    vi.advanceTimersByTime(60_000);
    await bumpLastActive("ada");
    expect(presenceBumpsFor()).toEqual(["ada", "ada"]);
  });

  it("throttles each user independently", async () => {
    await bumpLastActive("ada");
    await bumpLastActive("grace");
    expect(presenceBumpsFor()).toEqual(["ada", "grace"]);
  });

  it("does not suppress the retry after a failed write", async () => {
    mockPrisma.$executeRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(bumpLastActive("ada")).rejects.toThrow("db down");
    await bumpLastActive("ada");
    expect(presenceBumpsFor()).toEqual(["ada", "ada"]);
  });

  it("sweeps expired entries so the map stays bounded", async () => {
    for (let i = 0; i < 1_000; i++) await bumpLastActive(`u${i}`);
    expect(lastActiveThrottleSize()).toBe(1_000);
    vi.advanceTimersByTime(60_000);
    await bumpLastActive("late");
    expect(lastActiveThrottleSize()).toBe(1);
  });
});

describe("requireAuth — credential-miss audit logging", () => {
  it("logs auth.token.invalid when a bearer does not resolve", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer nope" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    expect(mockLogAuditEvent).toHaveBeenCalledWith({
      action: "auth.token.invalid",
      request: req,
    });
  });

  it("does not log for a stale cookie", async () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "dali.session_token=stale" },
    });
    await requireAuth(req);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });
});
