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
  normalizeRepo: (s: string) => (s.includes("/") ? s : null),
  createIssueForTask: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { createIssueForTask } from "~/projects/lib/github-task-sync";
import {
  runCreateTask,
  CREATE_TASK_TOOL,
  CreateTaskError,
} from "~/mcp/tools/create-task";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findFirst: ReturnType<typeof vi.fn> };
  userStory: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("create_task", () => {
  it("requires the mcp:write scope", () => {
    expect(CREATE_TASK_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "x" }),
    ).rejects.toMatchObject({ name: "CreateTaskError", status: 403 });
  });

  it("allows a non-Core project member (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: [] });
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        task: { create: vi.fn().mockResolvedValue({ id: "t-new" }) },
        taskAssignee: { createMany: vi.fn() },
      } as unknown as typeof prisma);
    });
    const out = await runCreateTask("u1", { projectId: "p1", title: "Build" });
    expect(out).toMatchObject({ id: "t-new" });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
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

  it("links a story and derives the epic from it (overriding epicId)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: [] });
    mockPrisma.userStory.findUnique.mockResolvedValue({
      epicId: "e-A",
      epic: { projectId: "p1" },
    });
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "t-new" });
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        task: { create },
        taskAssignee: { createMany: vi.fn() },
      } as unknown as typeof prisma);
    });

    await runCreateTask("u1", {
      projectId: "p1",
      title: "Build",
      storyId: "s1",
      epicId: "e-ignored",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storyId: "s1", epicId: "e-A" }),
      }),
    );
  });

  it("rejects a story from another project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: [] });
    mockPrisma.userStory.findUnique.mockResolvedValue({
      epicId: "e",
      epic: { projectId: "other" },
    });
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "t", storyId: "s1" }),
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
