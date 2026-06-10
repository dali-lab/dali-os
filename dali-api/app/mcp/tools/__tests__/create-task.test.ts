import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/projects/lib/github-task-sync", () => ({
  normalizeRepo: (s: string) => (s.includes("/") ? s : null),
  createIssueForTask: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { createIssueForTask } from "~/projects/lib/github-task-sync";
import {
  runCreateTask,
  CREATE_TASK_TOOL,
  CreateTaskError,
} from "~/mcp/tools/create-task";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("create_task", () => {
  it("requires the mcp:write scope", () => {
    expect(CREATE_TASK_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "x" }),
    ).rejects.toMatchObject({ name: "CreateTaskError", status: 403 });
  });

  it("rejects when project is missing", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runCreateTask("u1", { projectId: "nope", title: "t" }),
    ).rejects.toBeInstanceOf(CreateTaskError);
  });

  it("rejects a GitHub repo not in project.repoUrls", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      repoUrls: ["dali/alpha"],
    });
    await expect(
      runCreateTask("u1", {
        projectId: "p1",
        title: "t",
        mirrorToGithubRepo: "dali/other",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("creates with default Todo and triggers GH mirror when repo matches", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      repoUrls: ["dali/alpha"],
    });
    mockPrisma.task.findFirst.mockResolvedValue({ position: 4 });
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        task: { create: vi.fn().mockResolvedValue({ id: "t-new" }) },
        taskAssignee: { createMany: vi.fn() },
      } as unknown as typeof prisma);
    });

    const out = await runCreateTask("u1", {
      projectId: "p1",
      title: "Build it",
      mirrorToGithubRepo: "dali/alpha",
      assigneeUserIds: ["u2"],
    });
    expect(out).toMatchObject({ id: "t-new", status: "Todo", position: 5 });
    expect(createIssueForTask).toHaveBeenCalledWith("t-new", "dali/alpha");
  });
});
