import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerUser: { findUnique: vi.fn() },
    projectPartner: { findFirst: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  activeProjectPartnerWhere,
  partnerHasProjectAccess,
} from "../partner-access";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("activeProjectPartnerWhere", () => {
  const now = new Date("2026-07-06T12:00:00Z");
  const where = activeProjectPartnerWhere(now);

  it("treats null dates as unbounded and bounds set dates around now", () => {
    expect(where).toEqual({
      AND: [
        { OR: [{ startedAt: null }, { startedAt: { lte: now } }] },
        { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
      ],
    });
  });
});

describe("partnerHasProjectAccess", () => {
  it("rejects users with no PartnerUser row without querying links", async () => {
    mockPrisma.partnerUser.findUnique.mockResolvedValue(null);
    expect(await partnerHasProjectAccess("user1", "proj1")).toBe(false);
    expect(mockPrisma.projectPartner.findFirst).not.toHaveBeenCalled();
  });

  it("allows partners whose org has an active link to the project", async () => {
    mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
    mockPrisma.projectPartner.findFirst.mockResolvedValue({ id: "pp1" });
    expect(await partnerHasProjectAccess("user1", "proj1")).toBe(true);

    const arg = mockPrisma.projectPartner.findFirst.mock.calls[0][0];
    expect(arg.where.projectId).toBe("proj1");
    expect(arg.where.partnerOrgId).toBe("org1");
    // Archived projects never grant access.
    expect(arg.where.project).toEqual({ status: { not: "Archived" } });
    // Active-window predicate is part of the query.
    expect(arg.where.AND).toHaveLength(2);
  });

  it("rejects partners whose org has no active link", async () => {
    mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
    mockPrisma.projectPartner.findFirst.mockResolvedValue(null);
    expect(await partnerHasProjectAccess("user1", "proj1")).toBe(false);
  });
});
