import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runListMyTasks, LIST_MY_TASKS_TOOL } from "~/mcp/tools/list-my-tasks";

const mockPrisma = prisma as unknown as {
  task: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_my_tasks", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_MY_TASKS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("defaults to open statuses and filters by caller assignment", async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Wire up auth",
        status: "InProgress",
        priority: "High",
        dueAt: new Date("2026-06-10T00:00:00Z"),
        createdAt: new Date("2026-06-01T00:00:00Z"),
        projectId: "p1",
        project: { name: "Alpha" },
        sprintId: "s1",
        sprint: { name: "Sprint 1" },
        epicId: null,
        epic: null,
        domain: { displayName: "Dev" },
        assignees: [{ userId: "u1" }, { userId: "u2" }],
      },
    ]);
    const out = await runListMyTasks("u1", {});
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({
      id: "t1",
      projectName: "Alpha",
      sprintName: "Sprint 1",
      domainName: "Dev",
      assigneeUserIds: ["u1", "u2"],
      dueAt: "2026-06-10T00:00:00.000Z",
    });
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignees: { some: { userId: "u1" } },
          status: { in: ["Todo", "InProgress", "InReview"] },
        }),
      }),
    );
  });

  it("honors explicit status + projectId filters", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    await runListMyTasks("u1", { status: ["Done"], projectId: "p1" });
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["Done"] },
          projectId: "p1",
        }),
      }),
    );
  });
});
