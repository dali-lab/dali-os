import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/projects/lib/code-tasks.server", () => ({
  codeTaskDoneBlocker: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { codeTaskDoneBlocker } from "~/projects/lib/code-tasks.server";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runUpdateTaskStatus,
  UPDATE_TASK_STATUS_TOOL,
  UpdateTaskStatusError,
} from "~/mcp/tools/update-task-status";

const mockPrisma = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_task_status", () => {
  it("requires the mcp:write scope", () => {
    expect(UPDATE_TASK_STATUS_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects unknown statuses", async () => {
    await expect(
      runUpdateTaskStatus("u1", { taskId: "t1", status: "Reopened" }),
    ).rejects.toBeInstanceOf(UpdateTaskStatusError);
  });

  it("rejects the retired Backlog status", async () => {
    await expect(
      runUpdateTaskStatus("u1", { taskId: "t1", status: "Backlog" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses to move a task inside a closed sprint", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      sprintId: "old",
      sprint: { closedAt: new Date() },
      assignees: [{ userId: "u1" }],
    });
    await expect(
      runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("appends within the task's own sprint column", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      sprintId: "s4",
      sprint: { closedAt: null },
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.task.aggregate.mockResolvedValue({ _max: { position: 1 } });
    mockPrisma.task.update.mockResolvedValue({});
    await runUpdateTaskStatus("u1", { taskId: "t1", status: "InProgress" });
    expect(mockPrisma.task.aggregate.mock.calls[0]![0].where).toEqual({
      projectId: "p1",
      status: "InProgress",
      sprintId: "s4",
    });
  });

  it("refuses Done for a code task without a merged PR", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "InReview",
      projectId: "p1",
      sprintId: "s4",
      sprint: { closedAt: null },
      assignees: [{ userId: "u1" }],
    });
    vi.mocked(codeTaskDoneBlocker).mockResolvedValueOnce("attach a merged PR");
    await expect(
      runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" }),
    ).rejects.toMatchObject({ status: 409, message: "attach a merged PR" });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects when task is missing", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(
      runUpdateTaskStatus("u1", { taskId: "nope", status: "Done" }),
    ).rejects.toThrowError("Task not found");
  });

  it("allows an assignee to move their own task", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.task.aggregate.mockResolvedValue({ _max: { position: 4 } });
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" });
    expect(out).toMatchObject({ ok: true, previousStatus: "Todo", newStatus: "Done" });
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "Done", position: 5, activityAt: expect.any(Date) },
    });
    // Core should NOT be consulted when the caller is already an assignee.
    expect(isCore).not.toHaveBeenCalled();
  });

  it("allows Core to move someone else's task", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      assignees: [{ userId: "u-other" }],
    });
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.aggregate.mockResolvedValue({ _max: { position: null } });
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runUpdateTaskStatus("u1", { taskId: "t1", status: "InReview" });
    expect(out.newStatus).toBe("InReview");
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "InReview", position: 0, activityAt: expect.any(Date) },
    });
  });

  it("allows a non-assignee project member to move a task (web parity)", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      assignees: [{ userId: "u-other" }],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.task.aggregate.mockResolvedValue({ _max: { position: 0 } });
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" });
    expect(out.newStatus).toBe("Done");
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
  });

  it("forbids a non-assignee who can't edit the project", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      assignees: [{ userId: "u-other" }],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" }),
    ).rejects.toMatchObject({ name: "UpdateTaskStatusError", status: 403 });
  });
});
