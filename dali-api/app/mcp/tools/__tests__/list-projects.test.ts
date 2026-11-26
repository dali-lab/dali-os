import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, currentTerm: vi.fn() };
});

import { prisma } from "~/lib/db.server";
import { currentTerm } from "~/lib/roles";
import { runListProjects, LIST_PROJECTS_TOOL } from "~/mcp/tools/list-projects";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  project: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
  task: { groupBy: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.project.count = vi.fn().mockResolvedValue(0);
});

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

  it("filters to projects that ran in any of the given terms", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await runListProjects("u1", { terms: ["22F", "23W"] });
    const where = { projectTerms: { some: { term: { code: { in: ["22F", "23W"] } } } } };
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(mockPrisma.project.count).toHaveBeenCalledWith({ where });
  });

  it("combines status and term filters", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await runListProjects("u1", { status: ["Archived"], terms: ["22F"] });
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ["Archived"] },
          projectTerms: { some: { term: { code: { in: ["22F"] } } } },
        },
      }),
    );
  });

  it("rejects an empty or oversized term list via the schema", () => {
    const schema = LIST_PROJECTS_TOOL.inputSchema as JsonSchema;
    expect(validateInput({ terms: [] }, schema).ok).toBe(false);
    expect(validateInput({ terms: Array.from({ length: 61 }, (_, i) => `t${i}`) }, schema).ok).toBe(false);
    expect(validateInput({ terms: ["22F"] }, schema).ok).toBe(true);
  });

  it("no filter → no where clause (all statuses, matching the hub's archive view)", async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await runListProjects("u1", {});
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it("pages by offset with an id tiebreak and a real total", async () => {
    const row = (id: string) => ({ id, name: id, status: "Active", projectTerms: [], partners: [] });
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    mockPrisma.project.count.mockResolvedValue(3);
    mockPrisma.project.findMany.mockResolvedValueOnce([row("a"), row("b")]);
    const first = await runListProjects("u1", { limit: 1 });
    expect(first.projects.map((p) => p.id)).toEqual(["a"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 1, total: 3 });
    expect(mockPrisma.project.findMany.mock.calls[0][0].orderBy.at(-1)).toEqual({ id: "asc" });

    mockPrisma.project.findMany.mockResolvedValueOnce([row("b"), row("c")]);
    const second = await runListProjects("u1", { limit: 2, cursor: first.page.nextCursor! });
    expect(mockPrisma.project.findMany.mock.calls[1][0]).toMatchObject({ skip: 1, take: 3 });
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects a bad cursor", async () => {
    await expect(runListProjects("u1", { cursor: "nope" })).rejects.toThrow(/Invalid cursor/);
  });

  describe("mine", () => {
    const WIDE_TERM = {
      term: {
        code: "26S",
        startDate: new Date("2000-01-03T00:00:00Z"),
        endDate: new Date("2100-01-01T00:00:00Z"),
        sortKey: 1,
      },
    };

    it("returns only the caller's staffed projects with current-term detail, not the directory", async () => {
      vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
      mockPrisma.projectAssignment.findMany.mockResolvedValue([
        { projectId: "p1", termId: "t1", level: "P3", term: { code: "26S" }, domain: { displayName: "Fullstack Dev" } },
        { projectId: "p2", termId: "t-old", level: "P2", term: { code: "25F" }, domain: { displayName: "Design" } },
      ]);
      mockPrisma.project.findMany.mockResolvedValue([
        { id: "p1", name: "Alpha", status: "Active", imageUrl: null, projectTerms: [WIDE_TERM] },
        { id: "p2", name: "Beta", status: "Active", imageUrl: null, projectTerms: [] },
      ]);
      mockPrisma.task.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 7 } }]);

      const out = (await runListProjects("u1", { mine: true })) as { projects: Record<string, unknown>[] };
      expect(out).not.toHaveProperty("page");
      expect(out.projects).toHaveLength(2);
      expect(out.projects[0]).toMatchObject({
        id: "p1",
        currentTermAssignment: { termCode: "26S", domainName: "Fullstack Dev", level: "P3" },
        openTaskCount: 7,
      });
      expect(out.projects[1]).toMatchObject({ id: "p2", currentTermAssignment: null, activeSprint: null, openTaskCount: 0 });
      expect(mockPrisma.projectAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }),
      );
      expect(mockPrisma.project.count).not.toHaveBeenCalled();
    });

    it("returns an empty list when the caller has no assignments", async () => {
      vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
      mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
      await expect(runListProjects("u1", { mine: true })).resolves.toEqual({ projects: [] });
    });

    it("limits to the current term with currentTermOnly", async () => {
      vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
      mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
      await runListProjects("u1", { mine: true, currentTermOnly: true });
      expect(mockPrisma.projectAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ termId: "t1" }) }),
      );
    });
  });
});
