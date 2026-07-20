import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
// Only reached by the hiring-application category, which these tests keep
// empty (no reviewer rows, not Core) — stubbed so the module loads without
// the real hiring stack.
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "none" }),
}));

import { prisma } from "~/lib/db";
import { runSearch } from "~/lib/search.server";
import type { UserRoles } from "~/lib/roles";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// Plain lab member — no elevated flags, so only the ungated categories run.
const MEMBER: UserRoles = {
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  canViewForms: false,
  canViewStaffing: false,
};

const like = (q: string) => ({ contains: q, mode: "insensitive" });

beforeEach(() => {
  vi.clearAllMocks();
  // Categories not under test stay empty. Most models in the shared db mock
  // default findMany to []; user/cycleReviewer don't, so set them explicitly,
  // and re-pin the ones individual tests override.
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.cycleReviewer.findMany.mockResolvedValue([]);
  mockPrisma.project.findMany.mockResolvedValue([]);
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.projectFile.findMany.mockResolvedValue([]);
});

describe("runSearch gating", () => {
  it("returns nothing for a non-member session without querying", async () => {
    const results = await runSearch({
      userId: "u1",
      roles: { ...MEMBER, isLabMember: false },
      q: "query",
    });
    expect(results).toEqual([]);
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });
});

describe("runSearch — projects", () => {
  it("matches on description as well as name, excluding Archived", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "p1", name: "Atlas", description: "A query engine for lab data" },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "Archived" },
          OR: [{ name: like("query") }, { description: like("query") }],
        },
      }),
    );
    // Name doesn't contain the query — the description match must still rank.
    expect(results).toContainEqual({
      type: "project",
      id: "p1",
      title: "Atlas",
      subtitle: "Project",
      url: "/projects/p1",
    });
  });
});

describe("runSearch — tasks", () => {
  it("returns board tasks deep-linked to the task modal on the Work tab", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Query builder",
        status: "InProgress",
        projectId: "p1",
        project: { name: "DALI OS" },
      },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    // Tasks of Archived projects are excluded, like project search itself.
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          title: like("query"),
          project: { status: { not: "Archived" } },
        },
      }),
    );
    expect(results).toContainEqual({
      type: "project",
      id: "t1",
      title: "Query builder",
      subtitle: "DALI OS · In progress",
      url: "/projects/p1?tab=work&task=t1",
    });
  });
});

describe("runSearch — project files", () => {
  it("matches title or current version filename, excluding archived files", async () => {
    mockPrisma.projectFile.findMany.mockResolvedValue([
      {
        id: "f1",
        title: "Pitch deck",
        currentVersion: { fileName: "query-pitch-final.pdf" },
        project: { name: "Atlas" },
      },
    ]);

    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "query" });

    expect(mockPrisma.projectFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [
            { title: like("query") },
            { currentVersion: { fileName: like("query") } },
          ],
        },
      }),
    );
    // Title doesn't match — the filename field must carry the ranking.
    expect(results).toContainEqual({
      type: "document",
      id: "f1",
      title: "Pitch deck",
      subtitle: "Atlas",
      url: "/documents/file/f1",
    });
  });
});
