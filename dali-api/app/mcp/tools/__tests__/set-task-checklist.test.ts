import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runSetTaskChecklist,
  SET_TASK_CHECKLIST_TOOL,
} from "~/mcp/tools/set-task-checklist";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("set_task_checklist", () => {
  it("requires mcp:write", () => {
    expect(SET_TASK_CHECKLIST_TOOL.requiredScope).toBe("mcp:write");
  });

  it("allows assignee, normalizes items, returns count", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runSetTaskChecklist("u1", {
      taskId: "t1",
      items: [{ text: "  do thing  ", done: true }, { text: "next" }],
    });
    expect(out).toMatchObject({ ok: true, count: 2 });
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" } }),
    );
  });

  it("forbids a non-assignee who can't edit the project", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      assignees: [{ userId: "other" }],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runSetTaskChecklist("u1", { taskId: "t1", items: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows a non-assignee project member (web parity)", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      projectId: "p1",
      assignees: [{ userId: "other" }],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.task.update.mockResolvedValue({});
    const out = await runSetTaskChecklist("u1", {
      taskId: "t1",
      items: [{ text: "a" }],
    });
    expect(out).toMatchObject({ ok: true, count: 1 });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
  });
});
