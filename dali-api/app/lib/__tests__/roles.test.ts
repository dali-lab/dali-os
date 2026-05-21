import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  hasCycleAccess,
  isInstructor,
  canViewForms,
  canViewStaffing,
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
    expect(mockPrisma.cycleInterviewer.findFirst).not.toHaveBeenCalled();
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
