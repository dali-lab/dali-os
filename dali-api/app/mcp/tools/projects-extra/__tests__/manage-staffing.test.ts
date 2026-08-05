import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
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
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canManageStaffing: vi.fn() };
});
vi.mock("~/projects/lib/staffing-events.server", () => ({
  publishCycleChange: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { canManageStaffing } from "~/lib/roles";
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
  user: { findUnique: ReturnType<typeof vi.fn> };
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

  it("set_mentor_role upserts StaffingMentorRole", async () => {
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
  });

  it("add_board_member upserts StaffingBoardMember", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u2" });
    mockPrisma.staffingBoardMember.upsert.mockResolvedValue({});
    const out = await runManageStaffing("u1", {
      action: "add_board_member",
      cycleId: "c1",
      userId: "u2",
    });
    expect(out).toMatchObject({ ok: true });
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

  it("add_board_member throws when user not found", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(
      runManageStaffing("u1", { action: "add_board_member", cycleId: "c1", userId: "u-nope" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
