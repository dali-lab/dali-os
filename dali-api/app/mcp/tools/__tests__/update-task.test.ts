import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/projects/lib/github-task-sync", () => ({
  syncIssueForTask: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";
import {
  runUpdateTask,
  UPDATE_TASK_TOOL,
  UpdateTaskError,
} from "~/mcp/tools/update-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_task", () => {
  it("requires the mcp:write scope", () => {
    expect(UPDATE_TASK_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
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
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: null });
    await expect(
      runUpdateTask("u1", { taskId: "t1", title: "   " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("clears assignees and triggers GH sync when linked", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: 42 });
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
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", githubIssueNumber: null });
    const out = await runUpdateTask("u1", { taskId: "t1" });
    expect(out).toMatchObject({ noop: true });
  });
});
