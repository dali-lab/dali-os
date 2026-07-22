import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  hasCycleAccess,
  isInstructor,
  canViewForms,
  canViewStaffing,
  getActiveCoreCycleTermIds,
  isLabMentor,
} from "~/lib/roles";

// Phase 2: roles helpers now query AdminMembership / CoreAssignment /
// DomainLeadAssignment / cycleReviewer / cycleInterviewer (all keyed on
// userId). DALIMember is only used as a presence marker via findUnique.

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  adminMembership: { findUnique: ReturnType<typeof vi.fn> };
  coreAssignment: { findFirst: ReturnType<typeof vi.fn> };
  domainLeadAssignment: { findFirst: ReturnType<typeof vi.fn> };
  instructorAssignment: { findFirst: ReturnType<typeof vi.fn> };
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findFirst: ReturnType<typeof vi.fn> };
  projectAssignment: { findFirst: ReturnType<typeof vi.fn> };
  domainEligibility: { findFirst: ReturnType<typeof vi.fn> };
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  term: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_USER_IDS;

  (mockPrisma as any).dALIMember = { findUnique: vi.fn() };
  (mockPrisma as any).adminMembership = { findUnique: vi.fn() };
  (mockPrisma as any).coreAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).domainLeadAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).instructorAssignment = { findFirst: vi.fn() };
  (mockPrisma as any).cycleReviewer = { findFirst: vi.fn() };
  (mockPrisma as any).cycleInterviewer = { findFirst: vi.fn() };
  (mockPrisma as any).projectAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).domainEligibility = { findFirst: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).user = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
  };
  // Core access scopes to the active election cycle, looked up via
  // currentTerm (findFirst) → cycle window (findMany). Default to a Spring
  // term so Core checks resolve a non-empty cycle.
  (mockPrisma as any).term = {
    findFirst: vi.fn().mockResolvedValue({ id: "term-1", sortKey: 262 }),
    findMany: vi.fn().mockResolvedValue([{ id: "term-1" }]),
  };
});

const CYCLE_ID = "cycle-1";

// Helper — set up the typical "is a lab member" baseline.
function setRoleFlags(opts: { member?: boolean; admin?: boolean; core?: boolean; domainLead?: boolean; instructor?: boolean } = {}) {
  mockPrisma.dALIMember.findUnique.mockResolvedValue(opts.member !== false ? { id: "m1" } : null);
  mockPrisma.adminMembership.findUnique.mockResolvedValue(opts.admin ? { id: "a1" } : null);
  mockPrisma.coreAssignment.findFirst.mockResolvedValue(opts.core ? { id: "c1" } : null);
  mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(opts.domainLead ? { id: "d1" } : null);
  mockPrisma.instructorAssignment.findFirst.mockResolvedValue(opts.instructor ? { id: "i1" } : null);
}

describe("hasCycleAccess", () => {
  it("returns true for a hiring lead (via ADMIN_USER_IDS)", async () => {
    process.env.ADMIN_USER_IDS = "admin-user";
    setRoleFlags({ member: true });

    const result = await hasCycleAccess("admin-user", CYCLE_ID);

    expect(result).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
    // getUserRoles probes cycleInterviewer cycle-agnostically for the
    // isInterviewer flag; only the cycle-scoped access probe must be skipped.
    expect(mockPrisma.cycleInterviewer.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ applicationCycleId: CYCLE_ID }),
      }),
    );
  });

  it("returns true for a hiring lead (via Core assignment)", async () => {
    setRoleFlags({ member: true, core: true });

    expect(await hasCycleAccess("user-hl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a domain lead", async () => {
    setRoleFlags({ member: true, domainLead: true });

    expect(await hasCycleAccess("user-dl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a cycle reviewer", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue({ id: "cr-1" });
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-reviewer", CYCLE_ID)).toBe(true);
  });

  it("returns true for a cycle interviewer", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue({ id: "ci-1" });

    expect(await hasCycleAccess("user-interviewer", CYCLE_ID)).toBe(true);
  });

  it("returns false for a member who is neither lead nor participant", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-nobody", CYCLE_ID)).toBe(false);
  });

  it("returns false for a non-member (no DALIMember record)", async () => {
    setRoleFlags({ member: false });

    const result = await hasCycleAccess("applicant-user", CYCLE_ID);

    expect(result).toBe(false);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns false for a reviewer on a different cycle", async () => {
    setRoleFlags({ member: true });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-wrong-cycle", CYCLE_ID)).toBe(false);
  });
});

describe("isInstructor", () => {
  it("returns true with any InstructorAssignment row", async () => {
    setRoleFlags({ instructor: true });
    expect(await isInstructor("user-inst")).toBe(true);
  });

  it("returns false with no InstructorAssignment row", async () => {
    setRoleFlags({ instructor: false });
    expect(await isInstructor("user-x")).toBe(false);
  });
});

describe("canViewForms (Core, Admin, or Instructor)", () => {
  it("true for Core", async () => {
    setRoleFlags({ core: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("true for Admin", async () => {
    setRoleFlags({ admin: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("true for Instructor (not Core/Admin)", async () => {
    setRoleFlags({ instructor: true });
    expect(await canViewForms("u")).toBe(true);
  });

  it("false for a plain member", async () => {
    setRoleFlags({ member: true });
    expect(await canViewForms("u")).toBe(false);
  });
});

describe("getActiveCoreCycleTermIds (Spring-anchored Core cycle)", () => {
  // sortKey = year*10 + (W=1, S=2, X=3, F=4). A cycle window spans
  // [Spring N, Spring N+1) — i.e. [Y*10+2, (Y+1)*10+2). During Spring,
  // the prior cycle [(Y-1)*10+2, Y*10+2) is also active for the handoff.

  function expectWindow(
    currentSortKey: number,
    expected: { gte: number; lt: number },
  ) {
    mockPrisma.term.findFirst.mockResolvedValue({
      id: "current",
      sortKey: currentSortKey,
    });
    mockPrisma.term.findMany.mockResolvedValue([]);
    return getActiveCoreCycleTermIds().then(() => {
      expect(mockPrisma.term.findMany).toHaveBeenCalledWith({
        where: { sortKey: { gte: expected.gte, lt: expected.lt } },
        select: { id: true },
      });
    });
  }

  it("Summer 26X → cycle is [26S, 27S)", async () => {
    await expectWindow(263, { gte: 262, lt: 272 });
  });

  it("Fall 26F → cycle is [26S, 27S)", async () => {
    await expectWindow(264, { gte: 262, lt: 272 });
  });

  it("Winter 27W rolls back to the prior Spring → cycle is [26S, 27S)", async () => {
    await expectWindow(271, { gte: 262, lt: 272 });
  });

  it("Spring 27S includes prior cycle for election handoff → [26S, 28S)", async () => {
    await expectWindow(272, { gte: 262, lt: 282 });
  });

  it("returns [] when there is no current term", async () => {
    mockPrisma.term.findFirst.mockResolvedValue(null);
    const ids = await getActiveCoreCycleTermIds();
    expect(ids).toEqual([]);
    expect(mockPrisma.term.findMany).not.toHaveBeenCalled();
  });

  it("returns the matched term IDs from findMany", async () => {
    mockPrisma.term.findFirst.mockResolvedValue({ id: "x", sortKey: 263 });
    mockPrisma.term.findMany.mockResolvedValue([
      { id: "t-26s" },
      { id: "t-26x" },
    ]);
    expect(await getActiveCoreCycleTermIds()).toEqual(["t-26s", "t-26x"]);
  });
});

describe("isLabMentor (mentorship area gate)", () => {
  it("true for a current-term P3 ProjectAssignment", async () => {
    mockPrisma.projectAssignment.findFirst.mockResolvedValue({ id: "pa-1" });
    expect(await isLabMentor("u", "term-1")).toBe(true);
  });

  it("true for a current-term DomainLeadAssignment", async () => {
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue({ id: "dl-1" });
    expect(await isLabMentor("u", "term-1")).toBe(true);
  });

  it("true for a current-term CoreAssignment", async () => {
    mockPrisma.coreAssignment.findFirst.mockResolvedValue({ id: "c-1" });
    expect(await isLabMentor("u", "term-1")).toBe(true);
  });

  it("true for PM Mentor (PM eligibility P3 + any current-term role)", async () => {
    mockPrisma.domainEligibility.findFirst.mockResolvedValue({ id: "de-1" });
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u" });
    expect(await isLabMentor("u", "term-1")).toBe(true);
  });

  it("false for PM-eligible user with no current-term activity", async () => {
    mockPrisma.domainEligibility.findFirst.mockResolvedValue({ id: "de-1" });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    expect(await isLabMentor("u", "term-1")).toBe(false);
  });

  it("false when user has no mentor-shaped role this term", async () => {
    expect(await isLabMentor("u", "term-1")).toBe(false);
  });

  it("false when termId is unset and there is no current term", async () => {
    mockPrisma.term.findFirst.mockResolvedValueOnce(null);
    expect(await isLabMentor("u")).toBe(false);
  });
});

describe("canViewStaffing (Core or Admin only)", () => {
  it("true for Core", async () => {
    setRoleFlags({ core: true });
    expect(await canViewStaffing("u")).toBe(true);
  });

  it("true for Admin", async () => {
    setRoleFlags({ admin: true });
    expect(await canViewStaffing("u")).toBe(true);
  });

  it("false for Instructor without Core/Admin", async () => {
    setRoleFlags({ instructor: true });
    expect(await canViewStaffing("u")).toBe(false);
  });

  it("false for a plain member", async () => {
    setRoleFlags({ member: true });
    expect(await canViewStaffing("u")).toBe(false);
  });
});
