import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, currentTerm: vi.fn() };
});

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import {
  runGetProjectOverview,
  GET_PROJECT_OVERVIEW_TOOL,
  ProjectNotFoundError,
} from "~/mcp/tools/get-project-overview";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
  epic: { findFirst: ReturnType<typeof vi.fn> };
  task: { groupBy: ReturnType<typeof vi.fn> };
};

// Wide first-term window so "today" always falls in a sprint → deterministic.
const wideStart = new Date("2000-01-03T00:00:00Z"); // a Monday
const wideEnd = new Date("2100-01-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_project_overview", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_PROJECT_OVERVIEW_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns project + current-term roster + active sprint + counts", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      name: "Alpha",
      description: "Demo",
      status: "Active",
      imageUrl: null,
      repoUrls: ["https://github.com/dali/alpha"],
      overviewPageId: "pg-o",
      prdPageId: null,
      projectTerms: [
        { term: { code: "26S", sortKey: 2026.1, startDate: wideStart, endDate: wideEnd } },
        {
          term: {
            code: "26X",
            sortKey: 2026.2,
            startDate: new Date("2100-02-01T00:00:00Z"),
            endDate: new Date("2100-05-01T00:00:00Z"),
          },
        },
      ],
      partners: [{ partnerOrg: { id: "po1", name: "Acme" } }],
    });
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      {
        level: "P3",
        user: { id: "u1", firstName: "A", lastName: "B" },
        domain: { id: "d1", displayName: "Dev" },
      },
    ]);
    mockPrisma.epic.findFirst.mockResolvedValue({
      id: "e1",
      title: "Onboarding",
      description: null,
      status: "InProgress",
    });
    mockPrisma.task.groupBy.mockResolvedValue([
      { status: "Todo", _count: { _all: 3 } },
      { status: "Done", _count: { _all: 5 } },
    ]);

    const out = await runGetProjectOverview({ projectId: "p1" });
    expect(out).toMatchObject({
      id: "p1",
      name: "Alpha",
      termCodes: ["26S", "26X"],
      partners: [{ id: "po1", name: "Acme" }],
      currentTermRoster: [{ userId: "u1", name: "A B", domain: "Dev", level: "P3" }],
      currentEpic: { id: "e1", title: "Onboarding", status: "InProgress" },
      taskCountByStatus: { Todo: 3, InProgress: 0, InReview: 0, Done: 5, Cancelled: 0 },
    });
    // Current sprint is the term-anchored week containing today.
    expect(out.activeSprint?.label).toMatch(/^Sprint \d+$/);
    expect(typeof out.activeSprint?.endsAt).toBe("string");
  });

  it("throws when the project is missing", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1", code: "26S" } as never);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runGetProjectOverview({ projectId: "nope" }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});
