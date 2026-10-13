import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/projects/lib/sprints.server", () => ({
  ensureSprints: vi.fn(),
  loadSprintModels: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { ensureSprints, loadSprintModels } from "~/projects/lib/sprints.server";
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

  it("groups live sprinted tasks under their stored sprint, with closed snapshots", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", name: "Alpha", status: "Active" });
    vi.mocked(loadSprintModels).mockResolvedValue([
      {
        id: "s1",
        number: 1,
        termId: "26X",
        termCode: "26X",
        startsOn: "2000-06-01T00:00:00.000Z",
        endsOn: "2000-06-07T00:00:00.000Z",
        closed: true,
        plannedCount: 3,
        completedCount: 2,
        carriedOverCount: 1,
      },
      {
        id: "s2",
        number: 2,
        termId: "26X",
        termCode: "26X",
        startsOn: "2999-06-08T00:00:00.000Z",
        endsOn: "2999-06-14T00:00:00.000Z",
        closed: false,
        plannedCount: null,
        completedCount: null,
        carriedOverCount: null,
      },
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "A",
        status: "InProgress",
        priority: "Normal",
        epicId: "e1",
        sprintId: "s2",
        carryoverCount: 1,
        assignees: [{ user: { id: "u1", firstName: "A", lastName: "B" } }],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(4);

    const data = JSON.parse(await readProjectBoardResource("p1"));
    expect(ensureSprints).toHaveBeenCalledWith("p1");
    expect(data.sprints[0]).toMatchObject({
      id: "s1",
      phase: "closed",
      planned: 3,
      completed: 2,
      carriedOver: 1,
    });
    expect(data.sprints[1]).toMatchObject({ id: "s2", phase: "upcoming" });
    expect(data.sprints[1]).not.toHaveProperty("planned");
    expect(data.sprints[1].tasks.InProgress).toEqual([
      {
        id: "t1",
        title: "A",
        status: "InProgress",
        priority: "Normal",
        epicId: "e1",
        carriedOver: 1,
        assignees: [{ id: "u1", name: "A B" }],
      },
    ]);
    expect(data.backlog).toEqual({ openCount: 4 });
  });
});
