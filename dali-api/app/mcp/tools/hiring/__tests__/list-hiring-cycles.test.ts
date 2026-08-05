import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return {
    ...real,
    getUserRoles: vi.fn(),
  };
});

import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import {
  runListHiringCycles,
  LIST_HIRING_CYCLES_TOOL,
} from "../list-hiring-cycles";

const mockPrisma = prisma as unknown as {
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  applicationCycle: { findMany: ReturnType<typeof vi.fn> };
};

const coreRoles = {
  isCore: true,
  isDomainLead: false,
  isLabMember: true,
  isAdmin: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: true,
  canViewStaffing: true,
};

const noRoles = {
  isCore: false,
  isDomainLead: false,
  isLabMember: true,
  isAdmin: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
};

beforeEach(() => vi.clearAllMocks());

describe("list_hiring_cycles", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_HIRING_CYCLES_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws forbidden for a user with no hiring role", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(noRoles);
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);
    await expect(runListHiringCycles("u1")).rejects.toMatchObject({ status: 403 });
  });

  it("returns all cycles for a Core user", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      {
        id: "cy1",
        name: "Fall 2026",
        cycleType: "Standard",
        closeDate: new Date("2026-10-01"),
        createdAt: new Date("2026-09-01"),
        statusUpdates: [{ newStatus: "Open" }],
      },
    ]);
    const result = await runListHiringCycles("u1") as any[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "cy1", name: "Fall 2026", status: "Open" });
  });

  it("scopes cycles to reviewer assignments for non-Core user", async () => {
    vi.mocked(getUserRoles).mockResolvedValue(noRoles);
    mockPrisma.cycleReviewer.findFirst.mockResolvedValue({ applicationCycleId: "cy2" });
    mockPrisma.cycleInterviewer.findFirst.mockResolvedValue(null);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ applicationCycleId: "cy2" }]);
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([]);
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      {
        id: "cy2",
        name: "Winter 2027",
        cycleType: "Standard",
        closeDate: null,
        createdAt: new Date("2026-12-01"),
        statusUpdates: [{ newStatus: "Draft" }],
      },
    ]);
    const result = await runListHiringCycles("u2") as any[];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cy2");
    // Confirm the findMany was called with the scoped id filter.
    expect(mockPrisma.applicationCycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["cy2"] } } }),
    );
  });
});
