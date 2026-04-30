import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import {
  signAccessToken,
  verifyAccessToken,
  requireAuth,
  withAuth,
  validateCasTicket,
} from "~/lib/auth";
import { setTokenCookies } from "~/lib/cookies";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  refreshToken: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSecret validation", () => {
  it("throws when JWT_SECRET is shorter than 32 bytes", async () => {
    vi.stubEnv("JWT_SECRET", "too-short");
    await expect(
      signAccessToken({ sub: "u", email: "e@e.com", type: "member" }),
    ).rejects.toThrow("JWT_SECRET must be at least 32 bytes for HS256 security");
    vi.unstubAllEnvs();
  });

  it("throws when JWT_SECRET is unset", async () => {
    vi.stubEnv("JWT_SECRET", "");
    await expect(
      signAccessToken({ sub: "u", email: "e@e.com", type: "member" }),
    ).rejects.toThrow("JWT_SECRET not set");
    vi.unstubAllEnvs();
  });

  it("accepts a 32+ byte secret", async () => {
    // beforeAll secret is 36 bytes; this asserts the happy path explicitly
    const token = await signAccessToken({
      sub: "u",
      email: "e@e.com",
      type: "member",
    });
    expect(typeof token).toBe("string");
  });
});

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips a token", async () => {
    const token = await signAccessToken({
      sub: "user1",
      email: "a@b.com",
      type: "member",
    });
    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe("user1");
    expect(payload.email).toBe("a@b.com");
    expect(payload.type).toBe("member");
  });

  it("rejects an expired token", async () => {
    // sign a token in the past so it's already expired at real time
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - 60 * 60 * 1000)); // 1 hour ago
    const token = await signAccessToken({
      sub: "user1",
      email: "a@b.com",
      type: "member",
    });
    vi.useRealTimers();

    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});

describe("requireAuth", () => {
  it("returns 401 when no token is present", async () => {
    const req = new Request("http://localhost/api/test");
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
    // No DB write when no token at all.
    expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it("returns user when valid cookie is present and does not touch the DB", async () => {
    const token = await signAccessToken({
      sub: "u1",
      email: "e@e.com",
      type: "member",
    });
    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: `__dali_at=${token}` },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("u1");
      expect(result.setCookies).toBeUndefined();
    }
    expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it("returns user when valid Bearer header is present", async () => {
    const token = await signAccessToken({
      sub: "u2",
      email: "f@f.com",
      type: "dartmouth",
    });
    const req = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("u2");
    }
  });

  it("returns 401 on tampered token without attempting refresh", async () => {
    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: "__dali_at=garbage; __dali_rt=anything" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
    // Tampered AT — no refresh attempt, audit logged.
    expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.token.invalid" }),
    );
  });

  it("silently refreshes when AT is expired but RT is valid", async () => {
    // Sign an already-expired AT.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - 60 * 60 * 1000));
    const expiredToken = await signAccessToken({
      sub: "u3",
      email: "g@g.com",
      type: "member",
    });
    vi.useRealTimers();

    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-1",
      tokenHash: "doesnt-matter",
      userId: "u3",
      family: "fam-1",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });
    mockPrisma.refreshToken.update.mockResolvedValue({});
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u3",
      daliEmail: "g@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: null,
      firstName: "Test",
      lastName: "User",
    });

    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: `__dali_at=${expiredToken}; __dali_rt=valid-rt` },
    });

    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("u3");
      expect(result.setCookies).toBeDefined();
      expect(result.setCookies!.length).toBe(2);
      // New AT and RT are issued.
      expect(result.setCookies!.some((c) => c.startsWith("__dali_at="))).toBe(
        true,
      );
      expect(result.setCookies!.some((c) => c.startsWith("__dali_rt="))).toBe(
        true,
      );
      // RT cookie path is `/` so the browser sends it on every request.
      expect(result.setCookies!.some((c) => /__dali_rt=.*Path=\//.test(c))).toBe(
        true,
      );
    }
    // Old RT was revoked, new one created.
    expect(mockPrisma.refreshToken.update).toHaveBeenCalled();
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it("clears cookies and 401s when RT was already revoked (reuse detected)", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-2",
      tokenHash: "x",
      userId: "u4",
      family: "fam-2",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(),
    });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: "__dali_rt=reused-rt" },
    });

    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const cleared = result.response.headers.getSetCookie();
      expect(cleared.length).toBe(2);
      expect(cleared.some((c) => /__dali_at=;.*Max-Age=0/.test(c))).toBe(true);
      expect(cleared.some((c) => /__dali_rt=;.*Max-Age=0/.test(c))).toBe(true);
    }
    // The whole family was revoked.
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: "fam-2" } }),
    );
  });

  it("clears cookies and 401s when RT is unknown", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: "__dali_rt=ghost" },
    });

    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.headers.getSetCookie().length).toBe(2);
    }
  });

  it("de-duplicates concurrent refreshes that present the same RT", async () => {
    // Make findUnique resolve only after both calls have been made, so we
    // know the dedup map has had both lookups land on the same in-flight
    // promise.
    let resolveFind: (v: any) => void;
    mockPrisma.refreshToken.findUnique.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFind = res;
        }),
    );
    mockPrisma.refreshToken.update.mockResolvedValue({});
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u5",
      daliEmail: "h@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: null,
      firstName: "T",
      lastName: "U",
    });

    const headers = { Cookie: "__dali_rt=shared-rt" };
    const r1 = requireAuth(new Request("http://localhost/a", { headers }));
    const r2 = requireAuth(new Request("http://localhost/b", { headers }));

    // Resolve the in-flight DB lookup with a valid RT row.
    resolveFind!({
      id: "rt-3",
      tokenHash: "x",
      userId: "u5",
      family: "fam-3",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: null,
    });

    const [a, b] = await Promise.all([r1, r2]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // findUnique was called once (the dedup map collapsed both into one
    // refresh) — without dedup, the second caller would see `revokedAt` set
    // by the first caller's update and trip reuse detection.
    expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("withAuth", () => {
  it("is a no-op when no setCookies are present", () => {
    const auth = { ok: true as const, user: { sub: "u", email: "e", type: "m" } };
    const value = { foo: "bar" };
    expect(withAuth(auth, value)).toBe(value);

    const resp = new Response("ok");
    expect(withAuth(auth, resp)).toBe(resp);
    expect(resp.headers.getSetCookie()).toEqual([]);
  });

  it("appends Set-Cookie headers onto a Response on success", () => {
    const headers = new Headers();
    setTokenCookies(headers, "new-at", "new-rt");
    const setCookies = headers.getSetCookie();

    const auth = {
      ok: true as const,
      user: { sub: "u", email: "e", type: "m" },
      setCookies,
    };
    const resp = Response.json({ hello: "world" });
    const out = withAuth(auth, resp);

    expect(out).toBe(resp);
    expect(resp.headers.getSetCookie().length).toBe(2);
    expect(resp.headers.getSetCookie()).toEqual(setCookies);
  });

  it("forwards cleared cookies from a failure response", () => {
    // Build a failure auth result whose response carries cleared cookies.
    const inner = new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
    inner.headers.append(
      "Set-Cookie",
      "__dali_at=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
    inner.headers.append(
      "Set-Cookie",
      "__dali_rt=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
    const auth = { ok: false as const, response: inner };

    const redirected = new Response(null, {
      status: 302,
      headers: { Location: "/login" },
    });
    const out = withAuth(auth, redirected);
    expect(out).toBe(redirected);
    const cleared = redirected.headers.getSetCookie();
    expect(cleared.length).toBe(2);
    expect(cleared.some((c) => /__dali_at=;.*Max-Age=0/.test(c))).toBe(true);
    expect(cleared.some((c) => /__dali_rt=;.*Max-Age=0/.test(c))).toBe(true);
  });
});

describe("validateCasTicket", () => {
  it("parses a successful CAS response", async () => {
    const xml = `<cas:serviceResponse>
      <cas:authenticationSuccess>
        <cas:user>d12345a</cas:user>
        <cas:netid>d12345a</cas:netid>
        <cas:name>Jane Doe</cas:name>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(xml)),
    );

    const result = await validateCasTicket("ST-ticket", "http://localhost/cb");
    expect(result.netId).toBe("d12345a");
    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");

    vi.unstubAllGlobals();
  });

  it("throws on CAS failure response", async () => {
    const xml = `<cas:serviceResponse>
      <cas:authenticationFailure code="INVALID_TICKET">
        Ticket not recognized
      </cas:authenticationFailure>
    </cas:serviceResponse>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(xml)),
    );

    await expect(
      validateCasTicket("bad-ticket", "http://localhost/cb"),
    ).rejects.toThrow("CAS authentication failed");

    vi.unstubAllGlobals();
  });
});
