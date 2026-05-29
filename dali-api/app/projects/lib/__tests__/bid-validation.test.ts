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

  it("still records ONE bid on a project OUTSIDE the member's eligibility domains, at the project's domain/P1", async () => {
    // Member is Engineering-only, but bids a Design-only project. Eligibility
    // never gates a bid: it still resolves to one row, placed in the project's
    // declared domain at the baseline P1.
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

  it("records a bid on a project with NO declared domains in the member's own eligibility domain", async () => {
    // Real case (Deserto): the project declares zero ProjectDomain rows. The bid
    // must still resolve — fall back to the member's own highest-level
    // eligibility domain so it lands in a real column instead of vanishing.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([]);

    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "eng", level: "P3", preferenceRank: 1, notes: null },
    ]);
  });

  it("STILL records a bid when the project declares no domains AND the member has no eligibility (empty domain)", async () => {
    // The bid is never dropped. With no project domain and no member domain, it
    // falls back to the empty-string domain at P1 — the card still shows under
    // the project column (the board places bids by project, not domain).
    mockPrisma.domainEligibility.findMany.mockResolvedValue([]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([]);

    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "", level: "P1", preferenceRank: 1, notes: null },
    ]);
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

  it("still records a bid when the member has NO eligibility, in the project's first declared domain at P1", async () => {
    // No eligibility never drops a bid. With no member domain to prefer, it
    // lands in the project's first declared domain at the baseline P1.
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

  it("lands a multi-domain bid in the member's eligibility domain (single row, their level)", async () => {
    // Member eligible in eng (P2) only; project declares eng + design. ONE row,
    // in eng (the overlap) at P2 — never one-row-per-domain.
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

  it("picks the member's HIGHEST-level overlapping domain for a multi-domain project", async () => {
    // Member eligible in eng (P1) and design (P3); project declares both. The
    // single row uses design (P3) — the strongest claim wins.
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { domainId: "eng", level: "P1" },
      { domainId: "design", level: "P3" },
    ]);
    mockPrisma.projectDomain.findMany.mockResolvedValue([
      { projectId: "p1", domainId: "eng" },
      { projectId: "p1", domainId: "design" },
    ]);
    const res = await validateBids("u1", cycle, [{ projectId: "p1" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bids).toEqual([
      { projectId: "p1", domainId: "design", level: "P3", preferenceRank: 1, notes: null },
    ]);
  });

  it("records ONE bid when the project shares no domain with eligibility (project's first domain, P1)", async () => {
    // Member eligible in eng; project declares design + uiux (no overlap). Never
    // gated: one row in the project's first declared domain at P1.
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
