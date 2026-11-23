import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    staffingCycle: { findUnique: vi.fn() },
    staffingMentorRole: { upsert: vi.fn() },
    externalMentor: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    project: { findUnique: vi.fn() },
    domain: { findUnique: vi.fn() },
    staffingBoardMember: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canManageStaffing: vi.fn() };
});
vi.mock("~/projects/lib/staffing-events.server", () => ({
  publishCycleChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/staffing-assign.server", async (orig) => ({
  ...(await orig<object>()),
  assignStaffing: vi.fn(),
  setDomainEligibility: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { assignStaffing, setDomainEligibility } from "~/projects/lib/staffing-assign.server";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";
import { runManageStaffing, MANAGE_STAFFING_TOOL } from "~/mcp/tools/projects-extra/manage-staffing";

const mockPrisma = prisma as unknown as {
  staffingCycle: { findUnique: ReturnType<typeof vi.fn> };
  staffingMentorRole: { upsert: ReturnType<typeof vi.fn> };
  externalMentor: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  project: { findUnique: ReturnType<typeof vi.fn> };
  domain: { findUnique: ReturnType<typeof vi.fn> };
  staffingBoardMember: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.staffingCycle.findUnique.mockResolvedValue({ id: "c1" });
});

describe("manage_staffing", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_STAFFING_TOOL.requiredScope).toBe("mcp:write");
  });

  it("throws McpForbiddenError for non-staffing-manager", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    await expect(
      runManageStaffing("u1", { action: "set_mentor_role", cycleId: "c1", userId: "u2", isMentor: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpInvalidError for unknown action", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    await expect(
      runManageStaffing("u1", { action: "fly_to_moon", cycleId: "c1" } as any),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("set_mentor_role upserts StaffingMentorRole and audit-logs (A8)", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.staffingMentorRole.upsert.mockResolvedValue({});
    const out = await runManageStaffing("u1", {
      action: "set_mentor_role",
      cycleId: "c1",
      userId: "u2",
      isMentor: true,
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.staffingMentorRole.upsert).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staffing.mentorRole.set", targetId: "u2" }),
    );
  });

  it("add_board_member upserts StaffingBoardMember for a DALI member (A4)", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u2" });
    mockPrisma.staffingBoardMember.upsert.mockResolvedValue({});
    const out = await runManageStaffing("u1", {
      action: "add_board_member",
      cycleId: "c1",
      userId: "u2",
    });
    expect(out).toMatchObject({ ok: true });
    // Must query with the daliMember guard, not a bare findUnique.
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "u2", daliMember: { isNot: null } }),
      }),
    );
    expect(mockPrisma.staffingBoardMember.upsert).toHaveBeenCalled();
  });

  it("remove_board_member deletes rows", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.staffingBoardMember.deleteMany.mockResolvedValue({ count: 1 });
    const out = await runManageStaffing("u1", {
      action: "remove_board_member",
      cycleId: "c1",
      userId: "u2",
    });
    expect(out).toMatchObject({ ok: true });
    expect(mockPrisma.staffingBoardMember.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u2", staffingCycleId: "c1" },
    });
  });

  it("add_board_member rejects a non-DALI-member user (A4)", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(
      runManageStaffing("u1", { action: "add_board_member", cycleId: "c1", userId: "u-nope" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(mockPrisma.staffingBoardMember.upsert).not.toHaveBeenCalled();
  });
});

describe("manage_staffing assign and set_eligibility", () => {
  const request = new Request("http://x");

  beforeEach(() => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
  });

  it("lists both actions and needs only action in the schema", () => {
    const schema = MANAGE_STAFFING_TOOL.inputSchema as JsonSchema & { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(expect.arrayContaining(["assign", "set_eligibility"]));
    expect(schema.required).toEqual(["action"]);
    expect(validateInput({ action: "assign", cycleId: "c1", userId: "u", projectId: null }, schema).ok).toBe(true);
    expect(validateInput({ action: "assign", cycleId: "c1", userId: "u", projectId: 1 }, schema).ok).toBe(false);
  });

  it("assign proposes a placement as the caller", async () => {
    vi.mocked(assignStaffing).mockResolvedValue({ proposed: 1, clearedProposed: 0 } as never);
    const out = await runManageStaffing(
      "u1",
      { action: "assign", cycleId: "c1", userId: "u2", projectId: "p1", domains: [{ domainId: "d1", level: "P2" }] },
      { request },
    );
    expect(out).toEqual({ ok: true, proposed: 1, clearedProposed: 0 });
    expect(assignStaffing).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: "c1", userId: "u2", projectId: "p1", actorId: "u1", request }),
    );
    expect(mockPrisma.staffingCycle.findUnique).not.toHaveBeenCalled();
  });

  it("assign with projectId null removes the member", async () => {
    vi.mocked(assignStaffing).mockResolvedValue({ proposed: 0, clearedProposed: 2 } as never);
    await runManageStaffing("u1", { action: "assign", cycleId: "c1", userId: "u2", projectId: null, fromProjectId: "p9" });
    expect(assignStaffing).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, fromProjectId: "p9", domains: [] }),
    );
  });

  it("assign requires cycleId, userId and an explicit projectId", async () => {
    await expect(runManageStaffing("u1", { action: "assign", userId: "u2", projectId: "p1" })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
    await expect(runManageStaffing("u1", { action: "assign", cycleId: "c1", userId: "u2" })).rejects.toMatchObject({
      name: "McpInvalidError",
      message: expect.stringContaining("projectId"),
    });
    expect(assignStaffing).not.toHaveBeenCalled();
  });

  it("set_eligibility sets the level without a cycle", async () => {
    vi.mocked(setDomainEligibility).mockResolvedValue({ created: true } as never);
    const out = await runManageStaffing("u1", { action: "set_eligibility", userId: "u2", domainId: "d1", level: "P3" });
    expect(out).toEqual({ ok: true, created: true });
    expect(setDomainEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u2", domainId: "d1", level: "P3", actorId: "u1" }),
    );
  });

  it("set_eligibility requires userId, domainId and level", async () => {
    await expect(runManageStaffing("u1", { action: "set_eligibility", userId: "u2", domainId: "d1" })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
    expect(setDomainEligibility).not.toHaveBeenCalled();
  });

  it.each([
    ["assign", { cycleId: "c1", userId: "u2", projectId: "p1" }],
    ["set_eligibility", { userId: "u2", domainId: "d1", level: "P2" }],
  ] as const)("%s is refused to a non-manager before anything is written", async (action, args) => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    await expect(runManageStaffing("u1", { action, ...args } as never)).rejects.toMatchObject({ status: 403 });
    expect(assignStaffing).not.toHaveBeenCalled();
    expect(setDomainEligibility).not.toHaveBeenCalled();
  });
});
