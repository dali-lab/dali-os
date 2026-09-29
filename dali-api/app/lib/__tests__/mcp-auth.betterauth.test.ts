// Tests for Phase 4: BetterAuth coexistence in authenticateMcpRequest and
// mintBetterAuthSession. All external I/O is mocked.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Hoisted mocks (must come before any imports that trigger module execution) ─

const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());
const mockLookupSession = vi.hoisted(() => vi.fn());
const mockRollSession = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockOAuthGrantFindUnique = vi.hoisted(() => vi.fn());
const mockDALIMemberFindUnique = vi.hoisted(() => vi.fn());
const mockOAuthGrantUpdate = vi.hoisted(() => vi.fn());

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));

vi.mock("~/lib/session", () => ({
  lookupSession: mockLookupSession,
  rollSession: mockRollSession,
}));

vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    api: { getSession: mockGetSession },
    $context: Promise.resolve({
      internalAdapter: { createSession: mockCreateSession },
    }),
  },
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    oAuthGrant: {
      findUnique: mockOAuthGrantFindUnique,
      update: mockOAuthGrantUpdate,
    },
    dALIMember: { findUnique: mockDALIMemberFindUnique },
  },
}));

vi.mock("~/lib/cookies", () => ({
  parseSessionId: (req: Request) => req.headers.get("Authorization")?.replace("Bearer ", "") ?? null,
}));

// ── Import subjects after mocks ───────────────────────────────────────────────

import { authenticateMcpRequest } from "~/lib/mcp-auth";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GRANT_ID = "grant-abc";
const USER_ID = "user-xyz";
const CLIENT_ID = "mcp-client-1";
const CLIENT_NAME = "MCP Client";
const TOKEN = "ba-token-raw";

function makeRequest(token = TOKEN): Request {
  return new Request("https://example.com/mcp", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

const MOCK_USER = {
  id: USER_ID,
  daliEmail: "u@dali.dartmouth.edu",
  dartmouthEmail: null,
  netId: null,
  firstName: "U",
  lastName: "Ser",
};

const MOCK_GRANT = {
  id: GRANT_ID,
  revokedAt: null,
  scopes: ["lab:read", "profile:read"],
  clientId: CLIENT_ID,
  client: { name: CLIENT_NAME, requireMembership: false },
};

const MOCK_BA_SESSION = {
  session: { id: "sess-1", grantId: GRANT_ID },
  user: {
    id: USER_ID,
    daliEmail: "u@dali.dartmouth.edu",
    dartmouthEmail: null,
    netId: null,
    firstName: "U",
    lastName: "Ser",
  },
};

// ── Test helpers ──────────────────────────────────────────────────────────────

function setupLegacyMiss() {
  // Legacy lookupSession returns null — token not in bespoke Session table.
  mockLookupSession.mockResolvedValue(null);
}

function setupBetterAuthOn() {
  mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
}

function setupBetterAuthOff() {
  mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
}

function setupValidGrant() {
  mockOAuthGrantFindUnique.mockResolvedValue(MOCK_GRANT);
  mockOAuthGrantUpdate.mockResolvedValue({});
  mockDALIMemberFindUnique.mockResolvedValue(null); // not consulted unless requireMembership
}

// ── authenticateMcpRequest tests ──────────────────────────────────────────────

describe("authenticateMcpRequest — flag off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBetterAuthOff();
  });

  it("falls through to invalid_token when legacy lookup misses and flag is off", async () => {
    setupLegacyMiss();
    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    expect(mockGetSession).not.toHaveBeenCalled();
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("invalid_token");
  });

  it("succeeds via legacy path even when flag is off (grantId present)", async () => {
    const legacySession = {
      id: "hashed-1",
      userId: USER_ID,
      grantId: GRANT_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000),
      absoluteExpiresAt: new Date(Date.now() + 1_000_000),
      lastUsedAt: new Date(),
      user: MOCK_USER,
    };
    mockLookupSession.mockResolvedValue(legacySession);
    mockRollSession.mockResolvedValue(undefined);
    setupValidGrant();

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.grantId).toBe(GRANT_ID);
    expect(res.clientId).toBe(CLIENT_ID);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("does NOT consult BetterAuth when legacy path finds no session", async () => {
    setupLegacyMiss();
    await authenticateMcpRequest(makeRequest());
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});

describe("authenticateMcpRequest — flag on, BetterAuth path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLegacyMiss();
    setupBetterAuthOn();
    mockOAuthGrantUpdate.mockResolvedValue({});
  });

  it("succeeds: valid BetterAuth session with grantId + non-requireMembership client", async () => {
    mockGetSession.mockResolvedValue(MOCK_BA_SESSION);
    mockOAuthGrantFindUnique.mockResolvedValue(MOCK_GRANT);

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.grantId).toBe(GRANT_ID);
    expect(res.clientId).toBe(CLIENT_ID);
    expect(res.clientName).toBe(CLIENT_NAME);
    expect(res.scopes).toEqual(["lab:read", "profile:read"]);
    expect(res.user.id).toBe(USER_ID);
  });

  it("returns not_an_mcp_session when BetterAuth session has no grantId", async () => {
    mockGetSession.mockResolvedValue({
      session: { id: "sess-2", grantId: null },
      user: MOCK_BA_SESSION.user,
    });

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("not_an_mcp_session");
  });

  it("returns not_an_mcp_session when grantId field is absent", async () => {
    mockGetSession.mockResolvedValue({
      session: { id: "sess-3" }, // no grantId key at all
      user: MOCK_BA_SESSION.user,
    });

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("not_an_mcp_session");
  });

  it("returns invalid_token when BetterAuth getSession returns null", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("invalid_token");
  });

  it("returns grant_revoked when grant has revokedAt set", async () => {
    mockGetSession.mockResolvedValue(MOCK_BA_SESSION);
    mockOAuthGrantFindUnique.mockResolvedValue({
      ...MOCK_GRANT,
      revokedAt: new Date(),
    });

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("grant_revoked");
  });

  it("returns grant_revoked when grant is not found", async () => {
    mockGetSession.mockResolvedValue(MOCK_BA_SESSION);
    mockOAuthGrantFindUnique.mockResolvedValue(null);

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("grant_revoked");
  });

  it("returns not_a_member when requireMembership is true and no DALIMember row", async () => {
    mockGetSession.mockResolvedValue(MOCK_BA_SESSION);
    mockOAuthGrantFindUnique.mockResolvedValue({
      ...MOCK_GRANT,
      client: { name: CLIENT_NAME, requireMembership: true },
    });
    mockDALIMemberFindUnique.mockResolvedValue(null); // not a member

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("not_a_member");
  });

  it("succeeds when requireMembership is true and DALIMember row exists", async () => {
    mockGetSession.mockResolvedValue(MOCK_BA_SESSION);
    mockOAuthGrantFindUnique.mockResolvedValue({
      ...MOCK_GRANT,
      client: { name: CLIENT_NAME, requireMembership: true },
    });
    mockDALIMemberFindUnique.mockResolvedValue({ id: "member-1" });

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(true);
  });

  it("returns invalid_token (not 500) when BetterAuth throws", async () => {
    mockGetSession.mockRejectedValue(new Error("db hiccup"));

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(false);
    const body = await (res as { ok: false; response: Response }).response.json();
    expect(body.error.message).toContain("invalid_token");
  });

  it("legacy path wins when bespoke session exists even with betterauth flag on", async () => {
    // Override: legacy session IS found this time
    const legacySession = {
      id: "hashed-legacy",
      userId: USER_ID,
      grantId: GRANT_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000),
      absoluteExpiresAt: new Date(Date.now() + 1_000_000),
      lastUsedAt: new Date(),
      user: MOCK_USER,
    };
    mockLookupSession.mockResolvedValue(legacySession);
    mockRollSession.mockResolvedValue(undefined);
    mockOAuthGrantFindUnique.mockResolvedValue(MOCK_GRANT);

    const res = await authenticateMcpRequest(makeRequest());
    expect(res.ok).toBe(true);
    // BetterAuth should NOT have been consulted
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});

// ── mintBetterAuthSession tests ───────────────────────────────────────────────

describe("mintBetterAuthSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createSession with grantId in override and returns token + expiresAt", async () => {
    const mockSession = {
      token: "minted-token",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    mockCreateSession.mockResolvedValue(mockSession);

    const result = await mintBetterAuthSession({
      userId: USER_ID,
      grantId: GRANT_ID,
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const [calledUserId, calledDontRemember, calledOverride, calledOverrideAll] =
      mockCreateSession.mock.calls[0];
    expect(calledUserId).toBe(USER_ID);
    expect(calledDontRemember).toBe(false);
    expect(calledOverride).toMatchObject({ grantId: GRANT_ID });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(calledOverrideAll).toBe(false); // no custom TTL

    expect(result.token).toBe("minted-token");
    expect(result.expiresAt).toEqual(mockSession.expiresAt);
  });

  it("passes ipAddress and userAgent via override", async () => {
    mockCreateSession.mockResolvedValue({ token: "tok", expiresAt: new Date() });

    await mintBetterAuthSession({
      userId: USER_ID,
      grantId: GRANT_ID,
      ipAddress: "1.2.3.4",
      userAgent: "MCP/1.0",
    });

    const [, , override] = mockCreateSession.mock.calls[0];
    expect(override).toMatchObject({ ipAddress: "1.2.3.4", userAgent: "MCP/1.0" });
  });

  it("sets overrideAll=true and includes expiresAt when expiresInSec is provided", async () => {
    mockCreateSession.mockResolvedValue({ token: "tok", expiresAt: new Date() });

    const before = Date.now();
    await mintBetterAuthSession({
      userId: USER_ID,
      grantId: GRANT_ID,
      expiresInSec: 3600,
    });
    const after = Date.now();

    const [, , override, overrideAll] = mockCreateSession.mock.calls[0];
    expect(overrideAll).toBe(true);
    expect(override.expiresAt).toBeDefined();
    const ea = (override.expiresAt as Date).getTime();
    expect(ea).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(ea).toBeLessThanOrEqual(after + 3600 * 1000 + 50);
  });

  it("does NOT set overrideAll when no expiresInSec (token/expiresAt auto-generated)", async () => {
    mockCreateSession.mockResolvedValue({ token: "tok", expiresAt: new Date() });

    await mintBetterAuthSession({ userId: USER_ID });

    const [, , , overrideAll] = mockCreateSession.mock.calls[0];
    expect(overrideAll).toBe(false);
  });

  it("throws when createSession returns null", async () => {
    mockCreateSession.mockResolvedValue(null);

    await expect(mintBetterAuthSession({ userId: USER_ID })).rejects.toThrow(
      /createSession returned null/,
    );
  });
});
