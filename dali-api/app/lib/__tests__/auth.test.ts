import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

import {
  signAccessToken,
  verifyAccessToken,
  requireAuth,
  validateCasTicket,
} from "~/lib/auth";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
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
  });

  it("returns user when valid cookie is present", async () => {
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
    }
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

  it("returns 401 on invalid token", async () => {
    const req = new Request("http://localhost/api/test", {
      headers: { Cookie: "__dali_at=garbage" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
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
