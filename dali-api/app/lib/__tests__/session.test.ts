import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  issueSession,
  lookupSession,
  rollSession,
  revokeSession,
  revokeAllForUser,
  revokeAllForGrant,
  hashSessionId,
  ROLLING_TTL_MS,
  ABSOLUTE_TTL_MS,
  ROLL_MIN_INTERVAL_MS,
} from "~/lib/session";

const mockPrisma = prisma as unknown as {
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  mockPrisma.session = {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } as any;
});

describe("hashSessionId", () => {
  it("produces a base64url SHA-256 digest", () => {
    const hash = hashSessionId("raw");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32-byte SHA-256 → 43 base64url chars (no padding)
    expect(hash.length).toBe(43);
  });

  it("is deterministic", () => {
    expect(hashSessionId("x")).toBe(hashSessionId("x"));
  });
});

describe("issueSession", () => {
  it("stores the hashed id, never the raw, and returns the raw to caller", async () => {
    const result = await issueSession({ userId: "u-1" });
    expect(result.rawId).toMatch(/^[A-Za-z0-9_-]+$/);

    const args = mockPrisma.session.create.mock.calls[0][0];
    expect(args.data.id).toBe(hashSessionId(result.rawId));
    expect(args.data.id).not.toBe(result.rawId);
    expect(args.data.userId).toBe("u-1");
  });

  it("sets expiresAt to now + ROLLING_TTL_MS", async () => {
    const before = Date.now();
    await issueSession({ userId: "u-1" });
    const after = Date.now();
    const args = mockPrisma.session.create.mock.calls[0][0];
    const exp = (args.data.expiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + ROLLING_TTL_MS - 50);
    expect(exp).toBeLessThanOrEqual(after + ROLLING_TTL_MS + 50);
  });

  it("sets absoluteExpiresAt to now + ABSOLUTE_TTL_MS", async () => {
    const before = Date.now();
    await issueSession({ userId: "u-1" });
    const after = Date.now();
    const args = mockPrisma.session.create.mock.calls[0][0];
    const exp = (args.data.absoluteExpiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + ABSOLUTE_TTL_MS - 50);
    expect(exp).toBeLessThanOrEqual(after + ABSOLUTE_TTL_MS + 50);
  });

  it("threads userAgent, ip, and grantId through to the row", async () => {
    await issueSession({
      userId: "u-1",
      grantId: "grant-1",
      userAgent: "ua",
      ip: "1.2.3.4",
    });
    const args = mockPrisma.session.create.mock.calls[0][0];
    expect(args.data.userAgent).toBe("ua");
    expect(args.data.ip).toBe("1.2.3.4");
    expect(args.data.grantId).toBe("grant-1");
  });
});

describe("lookupSession", () => {
  it("returns null when the raw id is empty", async () => {
    expect(await lookupSession("")).toBeNull();
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no row matches the hashed id", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    expect(await lookupSession("raw")).toBeNull();
    expect(mockPrisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: hashSessionId("raw") } }),
    );
  });

  it("returns the row when present", async () => {
    const row = { id: hashSessionId("raw"), userId: "u-1", user: {} };
    mockPrisma.session.findUnique.mockResolvedValue(row);
    expect(await lookupSession("raw")).toBe(row);
  });
});

describe("rollSession", () => {
  const staleLastUsedAt = () =>
    new Date(Date.now() - ROLL_MIN_INTERVAL_MS - 1000);

  it("extends expiresAt up to the absolute cap", async () => {
    const absoluteExpiresAt = new Date(Date.now() + ROLLING_TTL_MS * 2);
    await rollSession({
      id: hashSessionId("x"),
      absoluteExpiresAt,
      lastUsedAt: staleLastUsedAt(),
    });
    const args = mockPrisma.session.update.mock.calls[0][0];
    expect(args.where.id).toBe(hashSessionId("x"));
    expect(args.data.expiresAt).toBeInstanceOf(Date);
    expect((args.data.expiresAt as Date).getTime()).toBeLessThanOrEqual(
      absoluteExpiresAt.getTime(),
    );
  });

  it("never extends past absoluteExpiresAt", async () => {
    const absoluteExpiresAt = new Date(Date.now() + 1000);
    await rollSession({
      id: hashSessionId("x"),
      absoluteExpiresAt,
      lastUsedAt: staleLastUsedAt(),
    });
    const args = mockPrisma.session.update.mock.calls[0][0];
    expect((args.data.expiresAt as Date).getTime()).toBe(
      absoluteExpiresAt.getTime(),
    );
  });

  it("issues a single UPDATE with no preliminary read", async () => {
    await rollSession({
      id: hashSessionId("x"),
      absoluteExpiresAt: new Date(Date.now() + ROLLING_TTL_MS),
      lastUsedAt: staleLastUsedAt(),
    });
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.session.update).toHaveBeenCalledTimes(1);
  });

  it("skips the write when lastUsedAt is fresher than ROLL_MIN_INTERVAL_MS", async () => {
    await rollSession({
      id: hashSessionId("x"),
      absoluteExpiresAt: new Date(Date.now() + ROLLING_TTL_MS),
      lastUsedAt: new Date(Date.now() - ROLL_MIN_INTERVAL_MS + 60_000),
    });
    expect(mockPrisma.session.update).not.toHaveBeenCalled();
  });

  it("rolls when lastUsedAt is null", async () => {
    await rollSession({
      id: hashSessionId("x"),
      absoluteExpiresAt: new Date(Date.now() + ROLLING_TTL_MS),
      lastUsedAt: null,
    });
    expect(mockPrisma.session.update).toHaveBeenCalledTimes(1);
    const args = mockPrisma.session.update.mock.calls[0][0];
    expect(args.data.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("revokeSession", () => {
  it("flips revokedAt on the row matching the hashed raw id", async () => {
    await revokeSession("raw");
    const args = mockPrisma.session.updateMany.mock.calls[0][0];
    expect(args.where.id).toBe(hashSessionId("raw"));
    expect(args.data.revokedAt).toBeInstanceOf(Date);
  });

  it("accepts an already-hashed id with { hashed: true }", async () => {
    await revokeSession(hashSessionId("raw"), { hashed: true });
    const args = mockPrisma.session.updateMany.mock.calls[0][0];
    expect(args.where.id).toBe(hashSessionId("raw"));
  });
});

describe("revokeAllForUser", () => {
  it("revokes only this user's active sessions", async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 3 });
    const n = await revokeAllForUser("u-1");
    expect(n).toBe(3);
    const args = mockPrisma.session.updateMany.mock.calls[0][0];
    expect(args.where.userId).toBe("u-1");
    expect(args.where.revokedAt).toBeNull();
  });
});

describe("revokeAllForGrant", () => {
  it("revokes only sessions tied to this grant", async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 2 });
    const n = await revokeAllForGrant("grant-1");
    expect(n).toBe(2);
    const args = mockPrisma.session.updateMany.mock.calls[0][0];
    expect(args.where.grantId).toBe("grant-1");
    expect(args.where.revokedAt).toBeNull();
  });
});
