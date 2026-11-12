import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/projects/lib/github-task-sync", () => ({
  closeIssueForTask: vi.fn().mockResolvedValue(undefined),
  syncIssueForTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskStatusChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db.server";
import { closeIssueForTask } from "~/projects/lib/github-task-sync";
import { notifyTaskStatusChanged } from "~/projects/lib/task-notifications.server";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runUpdateTaskStatus,
  UPDATE_TASK_STATUS_TOOL,
  UpdateTaskStatusError,
} from "~/mcp/tools/update-task-status";

const mockPrisma = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
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
    mockPrisma.task.findFirst.mockResolvedValue({ position: 4 });
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
    mockPrisma.task.findFirst.mockResolvedValue(null);
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
    mockPrisma.task.findFirst.mockResolvedValue({ position: 0 });
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

  it("notifies assignees, closes the linked GitHub issue and bumps activityAt (web parity)", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      status: "Todo",
      projectId: "p1",
      githubIssueNumber: 9,
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.task.update.mockResolvedValue({});
    await runUpdateTaskStatus("u1", { taskId: "t1", status: "Done" });
    expect(notifyTaskStatusChanged).toHaveBeenCalledWith("t1", "u1", "Done");
    expect(closeIssueForTask).toHaveBeenCalledWith("t1", "completed");
    expect(mockPrisma.task.update.mock.calls[0]![0].data.activityAt).toBeInstanceOf(Date);
  });
});
