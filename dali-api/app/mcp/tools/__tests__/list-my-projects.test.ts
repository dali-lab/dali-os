import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, currentTerm: vi.fn() };
});

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import {
  runListMyProjects,
  LIST_MY_PROJECTS_TOOL,
} from "~/mcp/tools/list-my-projects";

const mockPrisma = prisma as unknown as {
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
  task: { groupBy: ReturnType<typeof vi.fn> };
};

// A term window wide enough that "today" always falls inside it, so the
// computed current-sprint band is deterministically non-null in any test run.
const WIDE_TERM = {
  term: {
    code: "26S",
    startDate: new Date("2000-01-03T00:00:00Z"), // a Monday
    endDate: new Date("2100-01-01T00:00:00Z"),
    sortKey: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_my_projects", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_MY_PROJECTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns empty list when caller has no assignments", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    const out = await runListMyProjects("u1", {});
    expect(out).toEqual({ projects: [] });
  });

  it("enriches assignments with current sprint + open task count", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      {
        projectId: "p1",
        termId: "t1",
        level: "P3",
        term: { code: "26S" },
        domain: { displayName: "Fullstack Dev" },
      },
      {
        projectId: "p2",
        termId: "t-old",
        level: "P2",
        term: { code: "25F" },
        domain: { displayName: "Design" },
      },
    ]);
    mockPrisma.project.findMany.mockResolvedValue([
      // p1 runs a term whose window contains today → a current sprint exists.
      { id: "p1", name: "Alpha", status: "Active", imageUrl: null, projectTerms: [WIDE_TERM] },
      // p2 runs no terms → no current sprint.
      { id: "p2", name: "Beta", status: "Active", imageUrl: null, projectTerms: [] },
    ]);
    mockPrisma.task.groupBy.mockResolvedValue([
      { projectId: "p1", _count: { _all: 7 } },
    ]);

    const out = await runListMyProjects("u1", {});
    expect(out.projects).toHaveLength(2);
    // Current-term project sorts first.
    expect(out.projects[0]).toMatchObject({
      id: "p1",
      name: "Alpha",
      currentTermAssignment: { termCode: "26S", domainName: "Fullstack Dev", level: "P3" },
      openTaskCount: 7,
    });
    expect(out.projects[0].activeSprint?.label).toMatch(/^Sprint \d+$/);
    expect(typeof out.projects[0].activeSprint?.endsAt).toBe("string");
    expect(out.projects[1]).toMatchObject({
      id: "p2",
      currentTermAssignment: null,
      activeSprint: null,
      openTaskCount: 0,
    });
  });

  it("respects currentTermOnly", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.task.groupBy.mockResolvedValue([]);

    await runListMyProjects("u1", { currentTermOnly: true });
    expect(mockPrisma.projectAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ termId: "t1" }) }),
    );
  });
});
