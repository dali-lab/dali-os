import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runDeleteTask, DELETE_TASK_TOOL, DeleteTaskError } from "~/mcp/tools/delete-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("delete_task", () => {
  it("requires mcp:write", () => {
    expect(DELETE_TASK_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runDeleteTask("u1", { taskId: "t1" })).rejects.toMatchObject({ status: 403 });
  });

  it("404s on missing task", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(runDeleteTask("u1", { taskId: "x" })).rejects.toBeInstanceOf(DeleteTaskError);
  });

  it("deletes when Core and task exists", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1" });
    mockPrisma.$transaction.mockResolvedValue([]);
    const out = await runDeleteTask("u1", { taskId: "t1" });
    expect(out).toEqual({ ok: true, taskId: "t1" });
  });
});
