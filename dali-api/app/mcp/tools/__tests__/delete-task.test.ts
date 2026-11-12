import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isCore, isProjectMember } from "~/lib/roles";
import { runDeleteTask, DeleteTaskError } from "~/mcp/tools/delete-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => vi.clearAllMocks());

describe("delete_task", () => {
  it("rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    await expect(runDeleteTask("u1", { taskId: "t1" })).rejects.toMatchObject({ status: 403 });
  });

  it("404s on missing task", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(runDeleteTask("u1", { taskId: "x" })).rejects.toBeInstanceOf(DeleteTaskError);
  });

  it("deletes when caller can edit and task exists", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    mockPrisma.$transaction.mockResolvedValue([]);
    const out = await runDeleteTask("u1", { taskId: "t1" });
    expect(out).toEqual({ ok: true, taskId: "t1" });
  });

  it("writes a task.delete audit event with the request", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.task.findUnique.mockResolvedValue({ id: "t1", title: "Ship it", projectId: "p1" });
    mockPrisma.$transaction.mockResolvedValue([]);
    const request = new Request("http://localhost/mcp");
    await runDeleteTask("u1", { taskId: "t1" }, { request });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "task.delete",
      userId: "u1",
      targetId: "t1",
      metadata: { title: "Ship it", projectId: "p1" },
      request,
    });
  });
});
