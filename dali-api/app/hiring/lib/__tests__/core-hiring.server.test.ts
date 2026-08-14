import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { getActiveCoreCycleTermIds, currentTerm } from "~/lib/roles";
import { coreCycleTermIds } from "~/lib/core-cycle";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import {
  isCoreCycleEligible,
  defaultCoreReviewerIds,
  coreOnAccept,
} from "~/hiring/lib/core-hiring.server";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    coreAssignment: { findMany: vi.fn(), createMany: vi.fn() },
    domain: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  getActiveCoreCycleTermIds: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/core-cycle", () => ({ coreCycleTermIds: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({
  notifyAdminsOfPromotion: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  coreAssignment: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCoreCycleEligible", () => {
  it("is true for an active lab member", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u1" });
    await expect(isCoreCycleEligible("u1")).resolves.toBe(true);
    const where = mockPrisma.user.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: "u1",
      daliMember: { isNot: null },
      membershipStatus: "Active",
    });
  });

  it("is false when the user isn't an active member", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(isCoreCycleEligible("u1")).resolves.toBe(false);
  });
});

describe("defaultCoreReviewerIds", () => {
  afterEach(() => vi.useRealTimers());

  it("returns [] with no active Core cycle (and never queries users)", async () => {
    vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue([]);
    await expect(defaultCoreReviewerIds()).resolves.toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("keeps only Core members graduating within the next year", async () => {
    // Freeze "today" at 2026-08-14 → window is (now, 2027-08-14]. Commencement
    // is June 15 of the class year: 2027 lands inside; 2026/2028 don't.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00Z"));
    vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue(["term-1"]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "already-grad", classYear: 2026 },
      { id: "senior", classYear: 2027 },
      { id: "junior", classYear: 2028 },
    ]);

    await expect(defaultCoreReviewerIds()).resolves.toEqual(["senior"]);

    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      membershipStatus: "Active",
      classYear: { not: null },
      coreAssignments: { some: { termId: { in: ["term-1"] } } },
    });
  });
});

describe("coreOnAccept", () => {
  const ctx = {
    userId: "u1",
    actorId: "actor",
    domainId: "core-domain",
    firstName: "Sam",
    candidateEmail: "sam@dartmouth.edu",
  };

  it("materializes CoreAssignments across the cycle and notifies admins", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-x" } as never);
    vi.mocked(coreCycleTermIds).mockResolvedValue(["t1", "t2"]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([]);
    mockPrisma.coreAssignment.createMany.mockResolvedValue({ count: 2 });

    const result = await coreOnAccept(ctx);

    const created = mockPrisma.coreAssignment.createMany.mock.calls[0][0].data;
    expect(created).toEqual([
      { userId: "u1", termId: "t1", leadTitle: null },
      { userId: "u1", termId: "t2", leadTitle: null },
    ]);
    expect(notifyAdminsOfPromotion).toHaveBeenCalledWith({
      userId: "u1",
      actorId: "actor",
      summary: "joined Core",
    });
    expect(result).toEqual({ auditMeta: { coreTermsCreated: 2 }, provision: null });
  });

  it("is idempotent — only fills the terms not already covered", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-x" } as never);
    vi.mocked(coreCycleTermIds).mockResolvedValue(["t1", "t2"]);
    mockPrisma.coreAssignment.findMany.mockResolvedValue([{ termId: "t1" }]);
    mockPrisma.coreAssignment.createMany.mockResolvedValue({ count: 1 });

    const result = await coreOnAccept(ctx);

    const created = mockPrisma.coreAssignment.createMany.mock.calls[0][0].data;
    expect(created).toEqual([{ userId: "u1", termId: "t2", leadTitle: null }]);
    expect(result.auditMeta).toEqual({ coreTermsCreated: 1 });
  });

  it("still notifies admins when there's no active term (no rows created)", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    const result = await coreOnAccept(ctx);
    expect(mockPrisma.coreAssignment.createMany).not.toHaveBeenCalled();
    expect(notifyAdminsOfPromotion).toHaveBeenCalled();
    expect(result.auditMeta).toEqual({ coreTermsCreated: 0 });
  });
});
