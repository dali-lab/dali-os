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
  return { ...real, getUserRoles: vi.fn(), hasCycleAccess: vi.fn() };
});

import { prisma } from "~/lib/db";
import { getUserRoles, hasCycleAccess } from "~/lib/roles";
import { LIST_APPLICATIONS_TOOL, runListApplications } from "../list-applications";

const mockPrisma = prisma as unknown as {
  domainApplication: { findMany: ReturnType<typeof vi.fn> };
  applicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  cycleReviewer: { findMany: ReturnType<typeof vi.fn> };
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

const reviewerRoles = {
  ...coreRoles,
  isCore: false,
  canViewForms: false,
  canViewStaffing: false,
};

const fakeApp = {
  id: "da1",
  domainId: "dom1",
  domain: { displayName: "Design", name: "design" },
  challengeVersion: null,
  application: {
    id: "app1",
    user: { firstName: "Alice", lastName: "Smith" },
    statusUpdates: [
      { newStatus: "Submitted", createdAt: new Date("2026-09-15") },
    ],
  },
  _count: { reviews: 2 },
};

beforeEach(() => vi.clearAllMocks());

describe("list_applications", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_APPLICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws 404 when cycle not found", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue(null);
    await expect(
      runListApplications("u1", { cycleId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws forbidden when caller has no cycle access", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    await expect(
      runListApplications("u1", { cycleId: "cy1" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns all apps for a Core user", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp]);

    const result = await runListApplications("u1", { cycleId: "cy1" }) as any[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      domainApplicationId: "da1",
      applicantName: "Alice Smith",
      domain: "Design",
      status: "Submitted",
      reviewCount: 2,
    });
  });

  it("scopes to reviewer domains for non-Core caller", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(reviewerRoles);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([{ domainId: "dom1" }]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp]);

    const result = await runListApplications("u2", { cycleId: "cy1" }) as any[];
    expect(result).toHaveLength(1);
    // Confirm domain filter was applied via OR clause.
    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it("returns empty when reviewer has no assigned domains in cycle", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(reviewerRoles);
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);

    const result = await runListApplications("u2", { cycleId: "cy1" });
    expect(result).toEqual([]);
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("filters by status when provided", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: "cy1" });
    vi.mocked(hasCycleAccess).mockResolvedValue(true);
    vi.mocked(getUserRoles).mockResolvedValue(coreRoles);
    const draftApp = {
      ...fakeApp,
      id: "da2",
      application: {
        ...fakeApp.application,
        statusUpdates: [{ newStatus: "Draft", createdAt: new Date("2026-09-10") }],
      },
    };
    mockPrisma.domainApplication.findMany.mockResolvedValue([fakeApp, draftApp]);

    const result = await runListApplications("u1", { cycleId: "cy1", status: "Submitted" }) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("Submitted");
  });
});
