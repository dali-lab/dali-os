import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));

import { prisma } from "~/lib/db";
import { canManageStaffing } from "~/lib/roles";
import {
  runGetStaffingBoard,
  runSetStaffingAssignment,
  runSetDomainEligibility,
  StaffingForbiddenError,
  StaffingNotFoundError,
  StaffingInvalidError,
} from "~/mcp/tools/staffing";

// $transaction sits alongside the model namespaces, so it needs its own entry
// rather than being caught by the index signature.
const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };
const ME = "user-1";
const CYCLE = { id: "cyc-1", name: "26X staffing", termId: "term-1", term: { code: "26X" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  mockPrisma.staffingCycle.findUnique.mockResolvedValue(CYCLE);
  mockPrisma.staffingCycle.findFirst.mockResolvedValue(CYCLE);
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
});

describe("staffing permissions", () => {
  it("refuses every tool to a non-manager", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    await expect(runGetStaffingBoard(ME, {})).rejects.toThrow(StaffingForbiddenError);
    await expect(
      runSetStaffingAssignment(ME, { cycleId: "cyc-1", userId: "u", projectId: null }),
    ).rejects.toThrow(StaffingForbiddenError);
    await expect(
      runSetDomainEligibility(ME, { userId: "u", domainId: "d", level: "P2" }),
    ).rejects.toThrow(StaffingForbiddenError);
    expect(mockPrisma.staffingAssignment.deleteMany).not.toHaveBeenCalled();
  });
});

describe("get_staffing_board", () => {
  it("groups assignments by project and resolves names by id", async () => {
    // StaffingAssignment has no project/domain relation, so both are looked up.
    mockPrisma.staffingAssignment.findMany.mockResolvedValue([
      {
        userId: "u1",
        projectId: "p1",
        domainId: "d1",
        level: "P2",
        status: "Proposed",
        user: { firstName: "Ada", lastName: "Lovelace" },
      },
    ]);
    mockPrisma.staffingBoardMember.findMany.mockResolvedValue([
      { userId: "u1", user: { firstName: "Ada", lastName: "Lovelace" } },
      { userId: "u2", user: { firstName: "Grace", lastName: "Hopper" } },
    ]);
    mockPrisma.project.findMany.mockResolvedValue([{ id: "p1", name: "DALI OS" }]);
    mockPrisma.domain.findMany.mockResolvedValue([{ id: "d1", displayName: "Fullstack Dev" }]);

    const out = await runGetStaffingBoard(ME, {});
    expect(out.cycle).toEqual({ id: "cyc-1", name: "26X staffing", termCode: "26X" });
    // Unassigned column first, then projects.
    expect(out.columns[0]).toMatchObject({ projectId: null, projectName: "Unassigned" });
    expect(out.columns[0].members.map((m) => m.name)).toEqual(["Grace Hopper"]);
    expect(out.columns[1]).toMatchObject({ projectId: "p1", projectName: "DALI OS" });
    expect(out.columns[1].members[0]).toMatchObject({
      name: "Ada Lovelace",
      domain: "Fullstack Dev",
      level: "P2",
    });
  });

  it("omits the unassigned column when everyone is placed", async () => {
    mockPrisma.staffingAssignment.findMany.mockResolvedValue([
      {
        userId: "u1",
        projectId: "p1",
        domainId: "d1",
        level: "P2",
        status: "Proposed",
        user: { firstName: "Ada", lastName: "Lovelace" },
      },
    ]);
    mockPrisma.staffingBoardMember.findMany.mockResolvedValue([
      { userId: "u1", user: { firstName: "Ada", lastName: "Lovelace" } },
    ]);
    mockPrisma.project.findMany.mockResolvedValue([{ id: "p1", name: "DALI OS" }]);
    mockPrisma.domain.findMany.mockResolvedValue([{ id: "d1", displayName: "Fullstack Dev" }]);
    const out = await runGetStaffingBoard(ME, {});
    expect(out.columns.every((c) => c.projectId !== null)).toBe(true);
  });

  it("404s when no cycle exists at all", async () => {
    mockPrisma.staffingCycle.findFirst.mockResolvedValue(null);
    await expect(runGetStaffingBoard(ME, {})).rejects.toThrow(StaffingNotFoundError);
  });
});

describe("set_staffing_assignment", () => {
  beforeEach(() => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.domain.count.mockResolvedValue(1);
    mockPrisma.staffingAssignment.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("replaces only Proposed rows, leaving the audit trail intact", async () => {
    const res = await runSetStaffingAssignment(ME, {
      cycleId: "cyc-1",
      userId: "u1",
      projectId: "p1",
      domains: [{ domainId: "d1", level: "P2" }],
    });
    expect(res).toEqual({ ok: true, proposed: 1, clearedProposed: 1 });
    expect(mockPrisma.staffingAssignment.deleteMany.mock.calls[0][0].where).toMatchObject({
      status: "Proposed",
    });
    expect(mockPrisma.staffingAssignment.create.mock.calls[0][0].data).toMatchObject({
      status: "Proposed",
      termId: "term-1",
      assignedById: ME,
    });
  });

  it("creates one row per domain", async () => {
    mockPrisma.domain.count.mockResolvedValue(2);
    const res = await runSetStaffingAssignment(ME, {
      cycleId: "cyc-1",
      userId: "u1",
      projectId: "p1",
      domains: [
        { domainId: "d1", level: "P2" },
        { domainId: "d2", level: "P3" },
      ],
    });
    expect(res.proposed).toBe(2);
    expect(mockPrisma.staffingAssignment.create).toHaveBeenCalledTimes(2);
  });

  it("moves a member to Unassigned with projectId null and no domains", async () => {
    const res = await runSetStaffingAssignment(ME, {
      cycleId: "cyc-1",
      userId: "u1",
      projectId: null,
    });
    expect(res).toMatchObject({ proposed: 0, clearedProposed: 1 });
    expect(mockPrisma.staffingAssignment.create).not.toHaveBeenCalled();
  });

  it("requires domains when assigning to a project", async () => {
    await expect(
      runSetStaffingAssignment(ME, { cycleId: "cyc-1", userId: "u1", projectId: "p1" }),
    ).rejects.toThrow(/domains is required/);
  });

  it("rejects an unknown project or domain", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runSetStaffingAssignment(ME, {
        cycleId: "cyc-1",
        userId: "u1",
        projectId: "ghost",
        domains: [{ domainId: "d1", level: "P2" }],
      }),
    ).rejects.toThrow(StaffingNotFoundError);

    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.domain.count.mockResolvedValue(0);
    await expect(
      runSetStaffingAssignment(ME, {
        cycleId: "cyc-1",
        userId: "u1",
        projectId: "p1",
        domains: [{ domainId: "ghost", level: "P2" }],
      }),
    ).rejects.toThrow(StaffingInvalidError);
  });
});

describe("set_domain_eligibility", () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1" });
    mockPrisma.domain.findUnique.mockResolvedValue({ id: "d1" });
  });

  it("creates when absent", async () => {
    mockPrisma.domainEligibility.findFirst.mockResolvedValue(null);
    const res = await runSetDomainEligibility(ME, {
      userId: "u1",
      domainId: "d1",
      level: "P3",
    });
    expect(res).toEqual({ ok: true, created: true });
    expect(mockPrisma.domainEligibility.create).toHaveBeenCalled();
  });

  it("updates when present, rather than duplicating", async () => {
    mockPrisma.domainEligibility.findFirst.mockResolvedValue({ id: "de-1" });
    const res = await runSetDomainEligibility(ME, {
      userId: "u1",
      domainId: "d1",
      level: "P1",
    });
    expect(res).toEqual({ ok: true, created: false });
    expect(mockPrisma.domainEligibility.update.mock.calls[0][0].data).toEqual({ level: "P1" });
    expect(mockPrisma.domainEligibility.create).not.toHaveBeenCalled();
  });

  it("404s on an unknown member or domain", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(
      runSetDomainEligibility(ME, { userId: "ghost", domainId: "d1", level: "P1" }),
    ).rejects.toThrow(StaffingNotFoundError);
  });
});
