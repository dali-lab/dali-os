import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runListProjects, LIST_PROJECTS_TOOL } from "~/mcp/tools/list-projects";

const mockPrisma = prisma as unknown as {
  project: { findMany: ReturnType<typeof vi.fn> };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("list_projects", () => {
  it("scope is read (mirrors the member-browsable web hub)", () => {
    expect(LIST_PROJECTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns the full directory with staffed flags and sorted term codes", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: "p1",
        name: "DALI OS",
        status: "Active",
        projectTerms: [
          { term: { code: "26X", sortKey: 2 } },
          { term: { code: "26S", sortKey: 1 } },
        ],
        partners: [],
      },
      {
        id: "p2",
        name: "MakeOS",
        status: "Active",
        projectTerms: [{ term: { code: "26X", sortKey: 2 } }],
        partners: [{ partnerOrg: { id: "org1", name: "Make Co" } }],
      },
    ]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ projectId: "p1" }]);

    const out = await runListProjects("u1", {});
    expect(out.projects).toEqual([
      {
        id: "p1",
        name: "DALI OS",
        status: "Active",
        termCodes: ["26S", "26X"],
        partnerOrgs: [],
        staffed: true,
      },
      {
        id: "p2",
        name: "MakeOS",
        status: "Active",
        termCodes: ["26X"],
        partnerOrgs: [{ id: "org1", name: "Make Co" }],
        staffed: false,
      },
    ]);
  });

  it("passes a status filter through", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await runListProjects("u1", { status: ["Active"] });
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["Active"] } } }),
    );
  });

  it("no filter → no where clause (all statuses, matching the hub's archive view)", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await runListProjects("u1", {});
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});
