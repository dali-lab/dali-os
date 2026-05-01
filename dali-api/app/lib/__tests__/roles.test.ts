import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";

const mockPrisma = prisma as unknown as {
  dALIMember: { findFirst: ReturnType<typeof vi.fn> };
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_USER_IDS;

  (mockPrisma as any).dALIMember = { findFirst: vi.fn() };
  (mockPrisma as any).cycleReviewer = { findFirst: vi.fn() };
  (mockPrisma as any).cycleInterviewer = { findFirst: vi.fn() };
});

const CYCLE_ID = "cycle-1";

describe("hasCycleAccess", () => {
  it("returns true for a hiring lead (via ADMIN_USER_IDS)", async () => {
    process.env.ADMIN_USER_IDS = "admin-user";
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m1",
      roles: [],
      domainLeadAssignments: [],
    });

    const result = await hasCycleAccess("admin-user", CYCLE_ID);

    expect(result).toBe(true);
    // Should NOT query reviewer/interviewer tables
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.cycleInterviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a hiring lead (via HiringLead role)", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m2",
      roles: ["HiringLead"],
      domainLeadAssignments: [],
    });

    expect(await hasCycleAccess("user-hl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for an admin", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m-admin",
      roles: ["Admin"],
      domainLeadAssignments: [],
    });

    expect(await hasCycleAccess("user-admin", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a domain lead", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m3",
      roles: [],
      domainLeadAssignments: [{ id: "dla-1" }],
    });

    expect(await hasCycleAccess("user-dl", CYCLE_ID)).toBe(true);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns true for a cycle reviewer", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m4",
      roles: [],
      domainLeadAssignments: [],
    });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue({ id: "cr-1" });
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-reviewer", CYCLE_ID)).toBe(true);
  });

  it("returns true for a cycle interviewer", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m5",
      roles: [],
      domainLeadAssignments: [],
    });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue({ id: "ci-1" });

    expect(await hasCycleAccess("user-interviewer", CYCLE_ID)).toBe(true);
  });

  it("returns false for a member who is neither lead nor participant", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m6",
      roles: [],
      domainLeadAssignments: [],
    });
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-nobody", CYCLE_ID)).toBe(false);
  });

  it("returns false for a non-member (no DALIMember record)", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue(null);

    const result = await hasCycleAccess("applicant-user", CYCLE_ID);

    expect(result).toBe(false);
    expect(mockPrisma.cycleReviewer.findFirst).not.toHaveBeenCalled();
  });

  it("returns false for a reviewer on a different cycle", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({
      id: "m7",
      roles: [],
      domainLeadAssignments: [],
    });
    // findFirst returns null because the where clause won't match
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);

    expect(await hasCycleAccess("user-wrong-cycle", CYCLE_ID)).toBe(false);
  });
});
