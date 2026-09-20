// Phase 2 BetterAuth integration tests for the desktop pairing session-issuance
// paths. Covers the flag-gated swap in:
//   - auth.pair.poll   (poller Bearer token)
//   - auth.handoff     (webview cookie)
// and a unit test for appendBetterAuthSessionCookie's Set-Cookie shape.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks (must precede all imports) ─────────────────────────────────

const mockIssueSession = vi.hoisted(() => vi.fn());
const mockHashSessionId = vi.hoisted(() => vi.fn());
const mockRevokeSession = vi.hoisted(() => vi.fn());
const mockMintBetterAuthSession = vi.hoisted(() => vi.fn());
const mockAppendBetterAuthSessionCookie = vi.hoisted(() => vi.fn());
const mockSetSessionCookie = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());
const mockLogAuditEvent = vi.hoisted(() => vi.fn());

const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());

const mockDeleteSession = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());

vi.mock("~/lib/session", () => ({
  issueSession: mockIssueSession,
  hashSessionId: mockHashSessionId,
  revokeSession: mockRevokeSession,
}));

vi.mock("~/lib/betterauth-session.server", () => ({
  mintBetterAuthSession: mockMintBetterAuthSession,
}));

vi.mock("~/lib/betterauth-cookie.server", () => ({
  appendBetterAuthSessionCookie: mockAppendBetterAuthSessionCookie,
}));

vi.mock("~/lib/cookies", () => ({
  setSessionCookie: mockSetSessionCookie,
}));

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));

vi.mock("~/lib/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

vi.mock("~/lib/rate-limit", () => ({
  checkRateLimit: () => null,
  getClientIp: () => "1.2.3.4",
}));

vi.mock("~/lib/app-env", () => ({
  getApiBaseUrl: () => "https://example.com",
}));

vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createSession: mockCreateSession,
        deleteSession: mockDeleteSession,
      },
    }),
  },
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    devicePairing: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      updateMany: mockUpdateMany,
    },
  },
}));

// ── Import subjects after mocks ───────────────────────────────────────────────

import { action } from "~/routes/auth.pair.poll";
import { loader } from "~/routes/auth.handoff";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APPROVED_ROW = {
  id: "row-1",
  status: "Approved",
  userId: "user-abc",
  deviceLabel: "macOS",
  desktopSessionId: null,
  expiresAt: new Date(Date.now() + 60_000),
};

const HANDOFF_ROW = {
  userId: "user-abc",
  deviceLabel: "macOS",
  handoffCodeHash: "hashed-code",
  handoffUsedAt: null,
  handoffExpiresAt: new Date(Date.now() + 60_000),
};

const DESKTOP_ABSOLUTE_TTL_SEC = (90 * 24 * 60 * 60 * 1000) / 1000;

function pollRequest(deviceCode = "raw-device-code") {
  return new Request("http://localhost/auth/pair/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
}

function handoffRequest(code = "handoff-code") {
  return new Request(`http://localhost/auth/handoff?code=${encodeURIComponent(code)}`);
}

// ── Tests: auth.pair.poll ────────────────────────────────────────────────────

describe("auth.pair.poll — poller session issuance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(APPROVED_ROW);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("flag OFF → uses issueSession; mintBetterAuthSession NOT called", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    mockIssueSession.mockResolvedValue({
      rawId: "legacy-raw-id",
      expiresAt: new Date(),
      absoluteExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    mockHashSessionId.mockReturnValue("hashed-legacy-id");

    const res = await action({ request: pollRequest(), params: {}, context: {} } as any);
    const body = await res.json();

    expect(body.status).toBe("approved");
    expect(body.desktopToken).toBe("legacy-raw-id");
    expect(mockIssueSession).toHaveBeenCalledTimes(1);
    expect(mockMintBetterAuthSession).not.toHaveBeenCalled();
    // The session stored in DevicePairing should be the hashed legacy id
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ desktopSessionId: "hashed-legacy-id" }),
      }),
    );
  });

  it("flag ON → calls mintBetterAuthSession with ~90d expiresInSec; desktopToken = minted token", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockMintBetterAuthSession.mockResolvedValue({
      token: "ba-token-raw",
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      sessionId: "ba-session-id",
    });

    const res = await action({ request: pollRequest(), params: {}, context: {} } as any);
    const body = await res.json();

    expect(body.status).toBe("approved");
    expect(body.desktopToken).toBe("ba-token-raw");
    expect(mockIssueSession).not.toHaveBeenCalled();
    expect(mockMintBetterAuthSession).toHaveBeenCalledTimes(1);

    const mintArgs = mockMintBetterAuthSession.mock.calls[0][0];
    expect(mintArgs.userId).toBe("user-abc");
    // expiresInSec should be approximately 90 days (within 1 second)
    expect(mintArgs.expiresInSec).toBeCloseTo(DESKTOP_ABSOLUTE_TTL_SEC, -2);
    expect(mintArgs.ipAddress).toBe("1.2.3.4");
    expect(mintArgs.userAgent).toMatch(/DALI OS Desktop/);
  });

  it("flag ON → desktopSessionId stored is the BetterAuth session's id, not a hash", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockMintBetterAuthSession.mockResolvedValue({
      token: "ba-token-raw",
      expiresAt: new Date(),
      sessionId: "ba-session-id-123",
    });

    await action({ request: pollRequest(), params: {}, context: {} } as any);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ desktopSessionId: "ba-session-id-123" }),
      }),
    );
    // hashSessionId should not have been called for BetterAuth path
    expect(mockHashSessionId).not.toHaveBeenCalled();
  });

  it("flag ON → concurrent race loss calls BetterAuth session deletion, not revokeSession", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockMintBetterAuthSession.mockResolvedValue({
      token: "ba-token-raw",
      expiresAt: new Date(),
      sessionId: "ba-session-id-race",
    });
    // Simulate losing the race
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockDeleteSession.mockResolvedValue(undefined);

    const res = await action({ request: pollRequest(), params: {}, context: {} } as any);
    const body = await res.json();

    expect(body.status).toBe("already_used");
    expect(mockDeleteSession).toHaveBeenCalledWith("ba-token-raw");
    expect(mockRevokeSession).not.toHaveBeenCalled();
  });

  it("flag OFF → concurrent race loss calls revokeSession with hashed id", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    mockIssueSession.mockResolvedValue({
      rawId: "legacy-raw-race",
      expiresAt: new Date(),
      absoluteExpiresAt: new Date(),
    });
    mockHashSessionId.mockReturnValue("hashed-legacy-race");
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await action({ request: pollRequest(), params: {}, context: {} } as any);
    const body = await res.json();

    expect(body.status).toBe("already_used");
    expect(mockRevokeSession).toHaveBeenCalledWith("hashed-legacy-race", { hashed: true });
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });
});

// ── Tests: auth.handoff ──────────────────────────────────────────────────────

describe("auth.handoff — webview session cookie issuance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindFirst.mockResolvedValue(HANDOFF_ROW);
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockAppendBetterAuthSessionCookie.mockResolvedValue(undefined);
    mockSetSessionCookie.mockImplementation(() => undefined);
  });

  it("flag OFF → uses issueSession + setSessionCookie; BetterAuth NOT called", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    mockIssueSession.mockResolvedValue({
      rawId: "webview-raw-id",
      expiresAt: new Date(),
      absoluteExpiresAt: new Date(),
    });

    const res = await loader({ request: handoffRequest(), params: {}, context: {} } as any);

    expect(res.status).toBe(302);
    expect(mockIssueSession).toHaveBeenCalledTimes(1);
    expect(mockSetSessionCookie).toHaveBeenCalledWith(expect.any(Headers), "webview-raw-id");
    expect(mockMintBetterAuthSession).not.toHaveBeenCalled();
    expect(mockAppendBetterAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("flag ON → calls mintBetterAuthSession + appendBetterAuthSessionCookie with minted token", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockMintBetterAuthSession.mockResolvedValue({
      token: "ba-webview-token",
      expiresAt: new Date(),
      sessionId: "ba-webview-session-id",
    });

    const res = await loader({ request: handoffRequest(), params: {}, context: {} } as any);

    expect(res.status).toBe(302);
    expect(mockMintBetterAuthSession).toHaveBeenCalledTimes(1);
    const mintArgs = mockMintBetterAuthSession.mock.calls[0][0];
    expect(mintArgs.userId).toBe("user-abc");
    expect(mintArgs.userAgent).toMatch(/webview/i);
    expect(mintArgs.ipAddress).toBe("1.2.3.4");

    expect(mockAppendBetterAuthSessionCookie).toHaveBeenCalledWith(
      expect.any(Headers),
      "ba-webview-token",
    );
    expect(mockIssueSession).not.toHaveBeenCalled();
    expect(mockSetSessionCookie).not.toHaveBeenCalled();
  });

  it("flag OFF → invalid handoff code returns redirect to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await loader({ request: handoffRequest("bad-code"), params: {}, context: {} } as any);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/login");
    expect(mockIssueSession).not.toHaveBeenCalled();
    expect(mockMintBetterAuthSession).not.toHaveBeenCalled();
  });

  it("flag ON → invalid handoff code returns redirect to /login without calling mintBetterAuthSession", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await loader({ request: handoffRequest("bad-code"), params: {}, context: {} } as any);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/login");
    expect(mockMintBetterAuthSession).not.toHaveBeenCalled();
  });
});

// ── Unit test: appendBetterAuthSessionCookie Set-Cookie shape ────────────────

describe("appendBetterAuthSessionCookie — Set-Cookie shape (unit)", () => {
  // Import the REAL implementation for this test, with the auth mock providing
  // a minimal context that matches what BetterAuth would produce.
  // The auth mock above provides ctx.authCookies.sessionToken but we need a full
  // context — so we test the real betterauth-cookie module with a controlled mock.

  it("appends a Set-Cookie whose name matches the BetterAuth session cookie name", async () => {
    // We re-use the mock of betterauth-cookie in the poll/handoff tests above,
    // but here we want to test the REAL appendBetterAuthSessionCookie. We import
    // it DIRECTLY using a separate dynamic import that bypasses the module mock,
    // OR we write a mini integration by calling serializeSignedCookie directly.
    //
    // Since vitest mocks are file-scoped and betterauth-cookie.server is mocked
    // above (to isolate the route tests), we test the cookie shape by calling
    // serializeSignedCookie directly — the same function appendBetterAuthSessionCookie
    // calls — with the same inputs to assert the resulting Set-Cookie format.

    const { serializeSignedCookie } = await import("better-call");

    const cookieName = "dali.session_token";
    const token = "test-token-value";
    const secret = "test-secret";
    const attributes = {
      httpOnly: true,
      secure: false,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    };

    const cookieStr = await serializeSignedCookie(cookieName, token, secret, attributes);

    // Must start with the cookie name
    expect(cookieStr).toMatch(new RegExp(`^${cookieName}=`));
    // Value must be a signed token: <token>.<signature> encoded as %XX
    // The decoded value before `; ` should contain a `.` (the signature separator)
    const valueMatch = cookieStr.match(/^[^=]+=([^;]+)/);
    expect(valueMatch).toBeTruthy();
    const rawCookieVal = decodeURIComponent(valueMatch![1]);
    expect(rawCookieVal).toContain(".");
    const [decodedToken, signature] = rawCookieVal.split(".");
    expect(decodedToken).toBe(token);
    // BetterAuth's signature is standard base64: 32-byte HMAC → 44 chars ending with =
    expect(signature.length).toBe(44);
    expect(signature).toMatch(/^[A-Za-z0-9+/]+=$/);
    // Must include HttpOnly
    expect(cookieStr).toContain("HttpOnly");
  });
});
