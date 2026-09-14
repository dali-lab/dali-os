import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/mcp/tools/access", () => ({ canEditProject: vi.fn() }));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskComment: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { canEditProject } from "~/mcp/tools/access";
import {
  runAddTaskComment,
  ADD_TASK_COMMENT_TOOL,
} from "~/mcp/tools/add-task-comment";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  taskComment: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("add_task_comment", () => {
  it("requires mcp:write", () => {
    expect(ADD_TASK_COMMENT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("allows an assignee without checking project edit access", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.taskComment.create.mockResolvedValue({
      id: "c1",
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    const out = await runAddTaskComment("u1", { taskId: "t1", body: "hi" });
    expect(out).toMatchObject({ id: "c1", taskId: "t1" });
    // Assignee self-service short-circuits before the project-edit check.
    expect(canEditProject).not.toHaveBeenCalled();
  });

  it("allows a non-assignee project member (A10 — matches web comment gate)", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      assignees: [{ userId: "other" }],
    });
    vi.mocked(canEditProject).mockResolvedValue(true);
    mockPrisma.taskComment.create.mockResolvedValue({
      id: "c2",
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    const out = await runAddTaskComment("u1", { taskId: "t1", body: "hi" });
    expect(out).toMatchObject({ id: "c2", taskId: "t1" });
    expect(canEditProject).toHaveBeenCalledWith("u1", "p1");
  });

  it("forbids a non-assignee without project edit access", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      assignees: [{ userId: "other" }],
    });
    vi.mocked(canEditProject).mockResolvedValue(false);
    await expect(
      runAddTaskComment("u1", { taskId: "t1", body: "hi" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
