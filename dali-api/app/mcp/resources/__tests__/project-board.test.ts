import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  matchProjectBoardUri,
  readProjectBoardResource,
  ProjectBoardNotFoundError,
  PROJECT_BOARD_RESOURCE,
} from "~/mcp/resources/project-board";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => vi.clearAllMocks());

describe("project-board resource", () => {
  it("template + scope are right", () => {
    expect(PROJECT_BOARD_RESOURCE.uriTemplate).toBe("dali://projects/{projectId}/board");
    expect(PROJECT_BOARD_RESOURCE.requiredScope).toBe("mcp:read");
  });

  it("parses concrete URIs", () => {
    expect(matchProjectBoardUri("dali://projects/p1/board")).toEqual({ projectId: "p1" });
    expect(matchProjectBoardUri("dali://projects/p1/backlog")).toBeNull();
    expect(matchProjectBoardUri("dali://me")).toBeNull();
  });

  it("404s when the project is missing", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(readProjectBoardResource("nope")).rejects.toBeInstanceOf(
      ProjectBoardNotFoundError,
    );
  });

  it("groups tasks into sprint boards + backlog by their dates", async () => {
    // Term Jun 1 → Aug 1. Sprint 1 = Jun 1–7; a task due Jun 3 lands there.
    // Grouping is by task date vs band range, independent of "today".
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      name: "Alpha",
      status: "Active",
      projectTerms: [
        {
          term: {
            code: "26X",
            startDate: new Date("2026-06-01T00:00:00Z"),
            endDate: new Date("2026-08-01T00:00:00Z"),
            sortKey: 1,
          },
        },
      ],
    });
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "A",
        status: "Todo",
        priority: "Normal",
        startsAt: null,
        dueAt: new Date("2026-06-03T00:00:00Z"), // Sprint 1
        epicId: null,
        position: 0,
        assignees: [{ user: { id: "u1", firstName: "A", lastName: "B" } }],
      },
      {
        id: "t2",
        title: "B",
        status: "Todo",
        priority: "Normal",
        startsAt: null,
        dueAt: null, // undated → backlog
        epicId: null,
        position: 0,
        assignees: [],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(1);

    const text = await readProjectBoardResource("p1");
    const data = JSON.parse(text);
    // Sprint 1 is the first band (Jun 1–7); the Jun 3 task lands in it.
    expect(data.sprints[0].label).toBe("Sprint 1");
    expect(data.sprints[0].tasks.Todo.map((c: { id: string }) => c.id)).toEqual(["t1"]);
    expect(data.backlog.openCount).toBe(1);
    expect(data.backlog.tasks.Todo.map((c: { id: string }) => c.id)).toEqual(["t2"]);
  });
});
