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
  sprint: { findMany: ReturnType<typeof vi.fn> };
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

  it("groups tasks into sprint boards + backlog", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      name: "Alpha",
      status: "Active",
    });
    mockPrisma.sprint.findMany.mockResolvedValue([
      {
        id: "s1",
        name: "Sprint 1",
        status: "Active",
        startsAt: new Date("2026-06-01"),
        endsAt: new Date("2026-06-14"),
        epicId: null,
      },
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "A",
        status: "Todo",
        priority: "Normal",
        sprintId: "s1",
        epicId: null,
        position: 0,
        dueAt: null,
        assignees: [{ user: { id: "u1", firstName: "A", lastName: "B" } }],
      },
      {
        id: "t2",
        title: "B",
        status: "Todo",
        priority: "Normal",
        sprintId: null,
        epicId: null,
        position: 0,
        dueAt: null,
        assignees: [],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(1);

    const text = await readProjectBoardResource("p1");
    const data = JSON.parse(text);
    expect(data.sprints[0].tasks.Todo).toHaveLength(1);
    expect(data.backlog.openCount).toBe(1);
    expect(data.backlog.tasks.Todo).toHaveLength(1);
  });
});
