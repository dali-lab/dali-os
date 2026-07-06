import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
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

  it("allows an assignee without checking Core", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.taskComment.create.mockResolvedValue({
      id: "c1",
      createdAt: new Date("2026-06-06T00:00:00Z"),
    });
    const out = await runAddTaskComment("u1", { taskId: "t1", body: "hi" });
    expect(out).toMatchObject({ id: "c1", taskId: "t1" });
    expect(isCore).not.toHaveBeenCalled();
  });

  it("forbids non-assignee non-Core", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      assignees: [{ userId: "other" }],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runAddTaskComment("u1", { taskId: "t1", body: "hi" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
