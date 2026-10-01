import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("~/lib/db");
// The BetterAuth coexistence fallback in computeAuth lazy-imports these two.
// Mocking them keeps the BetterAuth instance out of this unit test and lets us
// drive the flag + session state directly.
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: vi.fn(),
}));
vi.mock("~/lib/betterauth-compat.server", () => ({
  resolveBetterAuthAuth: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth, validateCasTicket } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { resolveBetterAuthAuth } from "~/lib/betterauth-compat.server";
import {
  hashSessionId,
  ROLLING_TTL_MS,
  ABSOLUTE_TTL_MS,
  ROLL_MIN_INTERVAL_MS,
} from "~/lib/session";

const mockIsFeatureEnabledForEveryone =
  isFeatureEnabledForEveryone as unknown as ReturnType<typeof vi.fn>;
const mockResolveBetterAuthAuth =
  resolveBetterAuthAuth as unknown as ReturnType<typeof vi.fn>;
const mockLogAuditEvent =
  logAuditEvent as unknown as ReturnType<typeof vi.fn>;

// A 43-char base64url string — the shape looksLikeWellFormedSessionId accepts,
// i.e. a plausible-but-stale session id (benign, not logged).
const WELL_FORMED_SID = "A".repeat(43);

const mockPrisma = prisma as unknown as {
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $executeRaw: ReturnType<typeof vi.fn>;
};

// bumpLastActive is the only $executeRaw in this module, so its calls are the
// presence heartbeat. The user id is the single interpolated value.
function presenceBumpsFor(): string[] {
  return mockPrisma.$executeRaw.mock.calls.map((args: unknown[]) => String(args[1]));
}

function makeSessionRow(overrides: Partial<{
  id: string;
  userId: string;
  grantId: string | null;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    daliEmail: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
    firstName: string;
    lastName: string;
  };
}> = {}) {
  const userId = overrides.userId ?? "user-1";
  return {
    id: overrides.id ?? hashSessionId("raw-1"),
    userId,
    grantId: overrides.grantId ?? null,
    createdAt: new Date(),
    lastUsedAt: overrides.lastUsedAt ?? new Date(),
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + ROLLING_TTL_MS),
    absoluteExpiresAt:
      overrides.absoluteExpiresAt ?? new Date(Date.now() + ABSOLUTE_TTL_MS),
    revokedAt: overrides.revokedAt ?? null,
    userAgent: null,
    ip: null,
    user: overrides.user ?? {
      id: userId,
      daliEmail: "u@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: null,
      firstName: "U",
      lastName: "Ser",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.session ??= {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  } as any;
  mockPrisma.session.update.mockResolvedValue({});
  // Default: betterauth flag off, no BetterAuth session — so every existing
  // test exercises pure legacy behavior.
  mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
  mockResolveBetterAuthAuth.mockResolvedValue(null);
});

describe("requireAuth", () => {
  it("returns no_session when no cookie and no header", async () => {
    const req = new Request("http://localhost");
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
  });

  it("returns not_found when the session row is missing", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=ghost" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("returns revoked when the session has a revokedAt timestamp", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({ revokedAt: new Date() }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("revoked");
  });

  it("returns expired when expiresAt has passed", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("returns expired when absoluteExpiresAt has passed", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({
        // rolling not yet expired but absolute cap has passed
        expiresAt: new Date(Date.now() + 1000),
        absoluteExpiresAt: new Date(Date.now() - 1000),
      }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("succeeds with a valid cookie session and preserves auth.user.sub", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSessionRow());
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("user-1");
      expect(result.user.email).toBe("u@dali.dartmouth.edu");
      expect(result.user.type).toBe("member");
    }
  });

  it("accepts a Bearer header when no cookie is present", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSessionRow());
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
  });

  it("prefers the cookie over a Bearer header when both are present", async () => {
    mockPrisma.session.findUnique.mockImplementation(async ({ where }: any) => {
      // Only the cookie's hash should match
      if (where.id === hashSessionId("cookie-raw")) {
        return makeSessionRow({
          id: hashSessionId("cookie-raw"),
          userId: "user-cookie",
        });
      }
      return null;
    });
    const req = new Request("http://localhost", {
      headers: {
        Cookie: "__dali_sid=cookie-raw",
        Authorization: "Bearer header-raw",
      },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.sub).toBe("user-cookie");
  });

  it("looks up sessions by sha256(raw), never the raw value", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSessionRow());
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    await requireAuth(req);
    expect(mockPrisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: hashSessionId("raw-1") },
      }),
    );
  });

  it("rolls the session when lastUsedAt is older than ROLL_MIN_INTERVAL_MS", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({
        lastUsedAt: new Date(Date.now() - ROLL_MIN_INTERVAL_MS - 1000),
      }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    expect(mockPrisma.session.update).toHaveBeenCalledTimes(1);
    const args = mockPrisma.session.update.mock.calls[0][0];
    expect(args.where.id).toBe(hashSessionId("raw-1"));
  });

  it("skips the session-roll write when lastUsedAt is recent", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({ lastUsedAt: new Date() }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    expect(mockPrisma.session.update).not.toHaveBeenCalled();
  });

  it("derives auth.user.type as member, dartmouth, or partner based on user columns", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(
      makeSessionRow({
        user: {
          id: "user-1",
          daliEmail: null,
          dartmouthEmail: null,
          netId: "abc123",
          firstName: "Net",
          lastName: "Id",
        },
      }),
    );
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.type).toBe("dartmouth");
  });
});

describe("requireAuth — BetterAuth coexistence (Phase 1)", () => {
  it("does not consult BetterAuth when the betterauth flag is off", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const req = new Request("http://localhost"); // no legacy session
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
    expect(mockResolveBetterAuthAuth).not.toHaveBeenCalled();
  });

  it("authenticates via a BetterAuth session when the flag is on and legacy has none", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockResolveBetterAuthAuth.mockResolvedValue({
      user: { sub: "ba-user", email: "grad@dartmouth.edu", type: "dartmouth" },
      sessionId: "auth-session-1",
    });
    const req = new Request("http://localhost"); // no legacy cookie/bearer
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.sub).toBe("ba-user");
      expect(result.user.type).toBe("dartmouth");
      expect(result.sessionId).toBe("auth-session-1");
    }
  });

  it("falls back to the legacy failure when the flag is on but no BetterAuth session exists", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockResolveBetterAuthAuth.mockResolvedValue(null);
    const req = new Request("http://localhost");
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_session");
  });

  it("never consults BetterAuth when a valid legacy session is present, even with the flag on", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockPrisma.session.findUnique.mockResolvedValue(makeSessionRow());
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.sub).toBe("user-1");
    expect(mockResolveBetterAuthAuth).not.toHaveBeenCalled();
  });
});

describe("requireAuth — presence heartbeat", () => {
  it("bumps lastActiveAt for a legacy session", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(makeSessionRow());
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=raw-1" },
    });
    await requireAuth(req);
    expect(presenceBumpsFor()).toEqual(["user-1"]);
  });

  it("bumps lastActiveAt for a BetterAuth session", async () => {
    // The cutover regression: the BetterAuth leg returned a valid auth without
    // ever writing presence, so status dots and Admin's "Live now" tile went
    // dark for everyone the moment the flag was flipped on.
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockResolveBetterAuthAuth.mockResolvedValue({
      user: { sub: "ba-user", email: "u@dali.dartmouth.edu", type: "member" },
      sessionId: "auth-session-1",
    });
    const req = new Request("http://localhost");
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    expect(presenceBumpsFor()).toEqual(["ba-user"]);
  });

  it("does NOT bump lastActiveAt while an admin is impersonating", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockResolveBetterAuthAuth.mockResolvedValue({
      user: { sub: "target-user", email: "u@dali.dartmouth.edu", type: "member" },
      sessionId: "auth-session-1",
      impersonatedBy: "admin-user",
    });
    const req = new Request("http://localhost");
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.impersonatedBy).toBe("admin-user");
    expect(presenceBumpsFor()).toEqual([]);
  });
});

describe("requireAuth — credential-miss audit logging", () => {
  it("does NOT log auth.token.invalid when a Bearer misses legacy but succeeds via BetterAuth", async () => {
    // The regression that flooded the audit log after cutover: a BetterAuth
    // bearer is never a legacy session id, so it always misses lookupSession
    // first — but the request still authenticates, so nothing should be logged.
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockPrisma.session.findUnique.mockResolvedValue(null);
    mockResolveBetterAuthAuth.mockResolvedValue({
      user: { sub: "ba-user", email: "u@dartmouth.edu", type: "dartmouth" },
      sessionId: "auth-session-1",
    });
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer ba-token" },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(true);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("logs auth.token.invalid when a Bearer is rejected by BOTH backends", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
    mockPrisma.session.findUnique.mockResolvedValue(null);
    mockResolveBetterAuthAuth.mockResolvedValue(null);
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

  it("logs auth.token.invalid for a Bearer miss when the flag is off (legacy behavior preserved)", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    mockPrisma.session.findUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer nope" },
    });
    await requireAuth(req);
    expect(mockResolveBetterAuthAuth).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledWith({
      action: "auth.token.invalid",
      request: req,
    });
  });

  it("does NOT log for a well-formed but stale cookie (benign post-rotation miss)", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", {
      headers: { Cookie: `__dali_sid=${WELL_FORMED_SID}` },
    });
    const result = await requireAuth(req);
    expect(result.ok).toBe(false);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("logs auth.token.malformed for a malformed cookie value", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    const req = new Request("http://localhost", {
      headers: { Cookie: "__dali_sid=short" },
    });
    await requireAuth(req);
    expect(mockLogAuditEvent).toHaveBeenCalledWith({
      action: "auth.token.malformed",
      request: req,
    });
  });
});

describe("validateCasTicket", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns netId, firstName, lastName from CAS XML", async () => {
    const xml = `<?xml version="1.0"?>
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>abc123</cas:user>
    <cas:netid>abc123</cas:netid>
    <cas:name>Test User</cas:name>
  </cas:authenticationSuccess>
</cas:serviceResponse>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(xml, { status: 200 }),
    ));
    const out = await validateCasTicket("ticket-x", "https://example.com/cb");
    expect(out.netId).toBe("abc123");
    expect(out.firstName).toBe("Test");
    expect(out.lastName).toBe("User");
    vi.unstubAllGlobals();
  });

  it("decodes HTML entities in the CAS name (e.g. O'Neill)", async () => {
    const xml = `<?xml version="1.0"?>
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>f007g87</cas:user>
    <cas:netid>f007g87</cas:netid>
    <cas:name>Liam O&#39;Neill</cas:name>
  </cas:authenticationSuccess>
</cas:serviceResponse>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(xml, { status: 200 }),
    ));
    const out = await validateCasTicket("ticket-x", "https://example.com/cb");
    expect(out.firstName).toBe("Liam");
    expect(out.lastName).toBe("O'Neill");
    vi.unstubAllGlobals();
  });

  it("throws when CAS returns a failure document", async () => {
    const xml = `<?xml version="1.0"?>
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationFailure code="INVALID_TICKET">no such ticket</cas:authenticationFailure>
</cas:serviceResponse>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(xml, { status: 200 }),
    ));
    await expect(validateCasTicket("bad", "https://x")).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
