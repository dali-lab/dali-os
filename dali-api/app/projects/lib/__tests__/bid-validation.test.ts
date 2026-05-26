import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { validateBids, type BidCycle } from "~/projects/lib/bid-validation";

// The shared db mock doesn't define these models; attach vi.fns so this file
// can drive them. Cast through unknown since they're not on the shared stub.
const mockPrisma = prisma as unknown as {
  domainEligibility: { findMany: ReturnType<typeof vi.fn> };
  projectDomain: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  mockPrisma.domainEligibility = { findMany: vi.fn() };
  mockPrisma.projectDomain = { findMany: vi.fn() };
});

const cycle: BidCycle = {
  id: "cyc1",
  termId: "term-26X",
  maxPreferencesPerMember: 3,
};

describe("validateBids — domain-driven biddability", () => {
  it("resolves a bid when the project declares the member's eligibility domain (no role request needed)", async () => {
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    // Project works in Engineering — biddable, even with zero ProjectRoleRequest.
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
    ]);

    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "eng", level: "P3", preferenceRank: 1, notes: null },
    ]);
    // Biddability must come from ProjectDomain, not ProjectRoleRequest.
    expect(mockPrisma.projectDomain.findMany).toHaveBeenCalled();
  });

  it("records a bid on a project OUTSIDE the member's eligibility domains, at the default level", async () => {
    // Member is Engineering-only, but bids a Design-only project. The bid must
    // still resolve (product intent: every bid shows), labeled with the
    // project's domain at the baseline P1 since the member has no level there.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "design" },
    ]);

    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "design", level: "P1", preferenceRank: 1, notes: null },
    ]);
  });

  it("produces no rows only when the project declares no domains at all", async () => {
    // Nothing to do with eligibility — a project with zero ProjectDomain rows
    // has no column to place a bid in, so it contributes nothing.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([]);

    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([]);
  });

  it("uses the member's eligibility level, and ranks bids by submission order", async () => {
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P2" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
      { projectId: "p2", domainId: "eng" },
    ]);

    const res = await validateBids("u1", cycle, [
      { projectId: "p2" },
      { projectId: "p1" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p2", domainId: "eng", level: "P2", preferenceRank: 1, notes: null },
      { projectId: "p1", domainId: "eng", level: "P2", preferenceRank: 2, notes: null },
    ]);
  });

  it("resolves a bid even when the member has NO eligibility at all, at the default level", async () => {
    // No eligibility no longer drops bids. The project's declared domains drive
    // the rows; level falls back to P1 since the member has none.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
    ]);
    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "eng", level: "P1", preferenceRank: 1, notes: null },
    ]);
  });

  it("lands a bid only in the member's eligibility domain when the project overlaps it", async () => {
    // Member eligible in eng (P2) only; project declares eng + design. The bid
    // lands ONLY in eng (the overlap) at P2 — design is dropped because the
    // member is eligible somewhere in this project, so we don't spill into
    // domains they have nothing to do with.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P2" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
      { projectId: "p1", domainId: "design" },
    ]);
    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "eng", level: "P2", preferenceRank: 1, notes: null },
    ]);
  });

  it("expands across ALL project domains only when there's no eligibility overlap", async () => {
    // Member eligible in eng; project declares design + uiux (no overlap). The
    // bid falls back to every project domain at the default level so it shows.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "design" },
      { projectId: "p1", domainId: "uiux" },
    ]);
    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "design", level: "P1", preferenceRank: 1, notes: null },
      { projectId: "p1", domainId: "uiux", level: "P1", preferenceRank: 1, notes: null },
    ]);
  });

  it("de-duplicates the same project picked twice, keeping the highest rank", async () => {
    // Real case (Alexander): same project in all 3 slots. Must not reject the
    // whole submission — collapse to one bid at rank 1.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
    ]);

    const res = await validateBids("u1", cycle, [
      { projectId: "p1" },
      { projectId: "p1" },
      { projectId: "p1" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "eng", level: "P3", preferenceRank: 1, notes: null },
    ]);
  });

  it("caps at maxBids, keeping the top-ranked picks (no rejection)", async () => {
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
      { projectId: "p2", domainId: "eng" },
      { projectId: "p3", domainId: "eng" },
      { projectId: "p4", domainId: "eng" },
    ]);

    // 4 distinct picks, maxBids = 3 → keep p1,p2,p3.
    const res = await validateBids("u1", cycle, [
      { projectId: "p1" },
      { projectId: "p2" },
      { projectId: "p3" },
      { projectId: "p4" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids.map((b) => b.projectId)).toEqual(["p1", "p2", "p3"]);
    expect(res.bids.map((b) => b.preferenceRank)).toEqual([1, 2, 3]);
  });
});
