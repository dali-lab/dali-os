import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/github-task-sync", () => ({
  syncIssueForTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/sprints.server", () => ({
  activeSprintId: vi.fn(),
  checkSprintTarget: vi.fn().mockResolvedValue(null),
  resolveTaskPlacement: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";
import {
  activeSprintId,
  checkSprintTarget,
  resolveTaskPlacement,
} from "~/projects/lib/sprints.server";
import {
  runUpdateTask,
  UPDATE_TASK_TOOL,
  UpdateTaskError,
} from "~/mcp/tools/update-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  epic: { findUnique: ReturnType<typeof vi.fn> };
  userStory: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_task", () => {
  it("requires the mcp:write scope", () => {
    expect(UPDATE_TASK_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      githubIssueNumber: null,
      assignees: [],
    });
    await expect(
      runUpdateTask("u1", { taskId: "t1", title: "x" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects when task is missing", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(
      runUpdateTask("u1", { taskId: "nope", title: "x" }),
    ).rejects.toBeInstanceOf(UpdateTaskError);
  });

  it("rejects an empty title", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: null, assignees: [] });
    await expect(
      runUpdateTask("u1", { taskId: "t1", title: "   " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("clears assignees and triggers GH sync when linked", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: 42, assignees: [] });
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        task: { update: vi.fn() },
        taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() },
      } as unknown as typeof prisma);
    });
    const out = await runUpdateTask("u1", { taskId: "t1", assigneeUserIds: [] });
    expect(out).toMatchObject({ ok: true, taskId: "t1" });
    expect(syncIssueForTask).toHaveBeenCalledWith("t1");
  });

  it("returns noop when no fields change", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: null, assignees: [] });
    const out = await runUpdateTask("u1", { taskId: "t1" });
    expect(out).toMatchObject({ noop: true });
  });

  describe("sprint and epic", () => {
    let update: ReturnType<typeof vi.fn>;
    const row = (over: Record<string, unknown> = {}) => ({
      id: "t1",
      projectId: "p1",
      githubIssueNumber: null,
      epicId: "e0",
      sprintId: null,
      status: "Todo",
      sprint: null,
      assignees: [],
      ...over,
    });
    beforeEach(() => {
      vi.mocked(isCore).mockResolvedValue(true);
      update = vi.fn();
      mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
        (fn as (tx: unknown) => unknown)({ task: { update }, taskAssignee: {} }),
      );
    });

    it("moves to a sprint, the active sprint, or the backlog", async () => {
      mockPrisma.task.findUnique.mockResolvedValue(row());
      await runUpdateTask("u1", { taskId: "t1", sprintId: "s2" });
      expect(checkSprintTarget).toHaveBeenCalledWith("p1", "s2");
      expect(update.mock.calls[0]![0].data).toMatchObject({ sprintId: "s2" });

      vi.mocked(activeSprintId).mockResolvedValue("s-now");
      await runUpdateTask("u1", { taskId: "t1", sprintId: "current" });
      expect(update.mock.calls[1]![0].data).toMatchObject({ sprintId: "s-now" });

      mockPrisma.task.findUnique.mockResolvedValue(row({ sprintId: "s2", sprint: { closedAt: null } }));
      await runUpdateTask("u1", { taskId: "t1", sprintId: "" });
      expect(update.mock.calls[2]![0].data).toMatchObject({ sprintId: null });
    });

    it("rejects an invalid sprint target and a missing active sprint", async () => {
      mockPrisma.task.findUnique.mockResolvedValue(row());
      vi.mocked(checkSprintTarget).mockResolvedValueOnce({ error: "That sprint is closed" });
      await expect(runUpdateTask("u1", { taskId: "t1", sprintId: "old" })).rejects.toMatchObject({
        status: 400,
      });
      vi.mocked(activeSprintId).mockResolvedValue(null);
      await expect(
        runUpdateTask("u1", { taskId: "t1", sprintId: "current" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("freezes closed-sprint tasks except moving unfinished work out", async () => {
      mockPrisma.task.findUnique.mockResolvedValue(
        row({ sprintId: "old", status: "Done", sprint: { closedAt: new Date() } }),
      );
      await expect(runUpdateTask("u1", { taskId: "t1", title: "x" })).rejects.toMatchObject({
        status: 409,
      });
      mockPrisma.task.findUnique.mockResolvedValue(
        row({ sprintId: "old", status: "Todo", sprint: { closedAt: new Date() } }),
      );
      await runUpdateTask("u1", { taskId: "t1", sprintId: "" });
      expect(update.mock.calls[0]![0].data).toMatchObject({ sprintId: null });
    });

    it("validates an epic change against the project", async () => {
      mockPrisma.task.findUnique.mockResolvedValue(row());
      vi.mocked(resolveTaskPlacement).mockResolvedValueOnce({ epicId: "e1", sprintId: undefined });
      await runUpdateTask("u1", { taskId: "t1", epicId: "e1" });
      expect(update.mock.calls[0]![0].data).toMatchObject({ epicId: "e1" });
      vi.mocked(resolveTaskPlacement).mockResolvedValueOnce({ error: "Epic is not part of this project" });
      await expect(runUpdateTask("u1", { taskId: "t1", epicId: "x" })).rejects.toMatchObject({
        status: 400,
      });
    });
  });

});
