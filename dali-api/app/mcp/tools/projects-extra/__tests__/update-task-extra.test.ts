// Tests for newly added fields on update_task (description, startsAt).
// The existing update-task.test.ts covers the core contract; this file
// isolates the new-field behaviour so the change surface is clear.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
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

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";
import { runUpdateTask, UPDATE_TASK_TOOL } from "~/mcp/tools/update-task";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const TASK = {
  id: "t1",
  projectId: "p1",
  githubIssueNumber: null,
  epicId: null,
  storyId: null,
  assignees: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.task.findUnique.mockResolvedValue(TASK);
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
    const cb = fn as (tx: typeof prisma) => Promise<unknown>;
    return cb({
      task: { update: vi.fn() },
      taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() },
    } as unknown as typeof prisma);
  });
});

describe("update_task schema additions", () => {
  it("description and startsAt appear in inputSchema", () => {
    const props = UPDATE_TASK_TOOL.inputSchema.properties;
    expect(props).toHaveProperty("description");
    expect(props).toHaveProperty("startsAt");
  });

  it("sets description to trimmed value", async () => {
    const update = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({ task: { update }, taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() } } as unknown as typeof prisma);
    });
    await runUpdateTask("u1", { taskId: "t1", description: "  hello world  " });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: "hello world" }) }),
    );
  });

  it("clears description with empty string", async () => {
    const update = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({ task: { update }, taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() } } as unknown as typeof prisma);
    });
    await runUpdateTask("u1", { taskId: "t1", description: "" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: null }) }),
    );
  });

  it("sets startsAt from ISO string", async () => {
    const update = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({ task: { update }, taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() } } as unknown as typeof prisma);
    });
    await runUpdateTask("u1", { taskId: "t1", startsAt: "2026-09-01T00:00:00.000Z" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startsAt: new Date("2026-09-01T00:00:00.000Z") }),
      }),
    );
  });

  it("clears startsAt with empty string", async () => {
    const update = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({ task: { update }, taskAssignee: { deleteMany: vi.fn(), createMany: vi.fn() } } as unknown as typeof prisma);
    });
    await runUpdateTask("u1", { taskId: "t1", startsAt: "" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startsAt: null }) }),
    );
  });

  it("rejects invalid startsAt", async () => {
    await expect(
      runUpdateTask("u1", { taskId: "t1", startsAt: "not-a-date" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("triggers GH sync when description changes on a linked task", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...TASK, githubIssueNumber: 7 });
    await runUpdateTask("u1", { taskId: "t1", description: "Updated" });
    expect(syncIssueForTask).toHaveBeenCalledWith("t1");
  });
});
