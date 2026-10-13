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
vi.mock("~/projects/lib/sprints.server", () => ({
  resolveTaskPlacement: vi.fn(),
  activeSprintId: vi.fn(),
  openSprintForDay: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { createIssueForTask } from "~/projects/lib/github-task-sync";
import {
  activeSprintId,
  openSprintForDay,
  resolveTaskPlacement,
} from "~/projects/lib/sprints.server";
import { runCreateTask, CREATE_TASK_TOOL, CreateTaskError } from "~/mcp/tools/create-task";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

let created: Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  created = null;
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: ["dali/alpha"] });
  mockPrisma.task.findFirst.mockResolvedValue(null);
  vi.mocked(resolveTaskPlacement).mockImplementation(async (_p, input) => ({
    epicId: input.epicId ?? "general",
    sprintId: input.sprintId,
  }));
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
    const cb = fn as (tx: typeof prisma) => Promise<unknown>;
    return cb({
      task: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return { id: "t-new" };
        }),
      },
      taskAssignee: { createMany: vi.fn() },
    } as unknown as typeof prisma);
  });
});

describe("create_task", () => {
  it("requires the mcp:write scope and offers no Backlog status or dates", () => {
    expect(CREATE_TASK_TOOL.requiredScope).toBe("mcp:write");
    const props = CREATE_TASK_TOOL.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.status!.enum).not.toContain("Backlog");
    expect(props).not.toHaveProperty("dueAt");
    expect(props).not.toHaveProperty("startsAt");
    expect(props).toHaveProperty("sprintId");
  });

  it("rejects callers without project edit access", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(runCreateTask("u1", { projectId: "p1", title: "x" })).rejects.toMatchObject({
      name: "CreateTaskError",
      status: 403,
    });
  });

  it("allows a non-Core project member (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const out = await runCreateTask("u1", { projectId: "p1", title: "Build" });
    expect(out).toMatchObject({ id: "t-new" });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
  });

  it("rejects a missing project, a Backlog status, and a foreign repo", async () => {
    mockPrisma.project.findUnique.mockResolvedValueOnce(null);
    await expect(runCreateTask("u1", { projectId: "nope", title: "t" })).rejects.toBeInstanceOf(
      CreateTaskError,
    );
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "t", status: "Backlog" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "t", mirrorToGithubRepo: "dali/other" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("defaults to the backlog under General", async () => {
    const out = await runCreateTask("u1", { projectId: "p1", title: "Build" });
    expect(out).toMatchObject({ epicId: "general", sprintId: null, status: "Todo" });
    expect(created).toMatchObject({ epicId: "general", sprintId: null });
  });

  it("places into a given sprint, or the active one for \"current\"", async () => {
    await runCreateTask("u1", { projectId: "p1", title: "A", sprintId: "s9", epicId: "e1" });
    expect(resolveTaskPlacement).toHaveBeenLastCalledWith("p1", { epicId: "e1", sprintId: "s9" });

    vi.mocked(activeSprintId).mockResolvedValue("s-now");
    await runCreateTask("u1", { projectId: "p1", title: "B", sprintId: "current" });
    expect(created).toMatchObject({ sprintId: "s-now" });

    vi.mocked(activeSprintId).mockResolvedValue(null);
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "C", sprintId: "current" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("maps a meeting action item's day onto the open sprint containing it", async () => {
    vi.mocked(openSprintForDay).mockResolvedValue("s-fri");
    await runCreateTask("u1", { projectId: "p1", title: "D", forDay: "2026-10-16T00:00:00.000Z" });
    expect(openSprintForDay).toHaveBeenCalledWith("p1", Date.UTC(2026, 9, 16));
    expect(created).toMatchObject({ sprintId: "s-fri" });
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "E", forDay: "not-a-date" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("surfaces placement errors", async () => {
    vi.mocked(resolveTaskPlacement).mockResolvedValueOnce({ error: "That sprint is closed" });
    await expect(
      runCreateTask("u1", { projectId: "p1", title: "F", sprintId: "old" }),
    ).rejects.toMatchObject({ status: 400, message: "That sprint is closed" });
  });

  it("appends to the end of its sprint column and mirrors to GitHub", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ position: 4 });
    const out = await runCreateTask("u1", {
      projectId: "p1",
      title: "Build it",
      sprintId: "s1",
      mirrorToGithubRepo: "dali/alpha",
      assigneeUserIds: ["u2"],
    });
    expect(mockPrisma.task.findFirst.mock.calls[0]![0].where).toEqual({
      projectId: "p1",
      status: "Todo",
      sprintId: "s1",
    });
    expect(out).toMatchObject({ id: "t-new", status: "Todo", position: 5 });
    expect(createIssueForTask).toHaveBeenCalledWith("t-new", "dali/alpha");
  });
});
