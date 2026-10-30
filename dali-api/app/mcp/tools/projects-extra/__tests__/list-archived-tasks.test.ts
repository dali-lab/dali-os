import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    task: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  },
}));
vi.mock("~/lib/display", () => ({
  fullName: (u: { firstName: string; lastName: string }) =>
    `${u.firstName} ${u.lastName}`.trim(),
}));
vi.mock("~/lib/prisma-shapes", () => ({
  USER_NAME_SELECT: { id: true, firstName: true, lastName: true },
}));

import { prisma } from "~/lib/db";
import {
  runListArchivedTasks,
  LIST_ARCHIVED_TASKS_TOOL,
} from "~/mcp/tools/projects-extra/list-archived-tasks";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_archived_tasks", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_ARCHIVED_TASKS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws McpNotFoundError for unknown project", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    await expect(
      runListArchivedTasks("u1", { projectId: "nope" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns empty list when no archived tasks", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.task.findMany.mockResolvedValue([]);
    const out = await runListArchivedTasks("u1", { projectId: "p1" });
    expect(out).toEqual({ tasks: [], page: { nextCursor: null, hasMore: false, limit: 50, total: 0 } });
  });

  it("returns archived tasks with ISO dates and assignees", async () => {
    const archivedAt = new Date("2026-09-10T12:00:00.000Z");
    const dueAt = new Date("2026-09-08T00:00:00.000Z");
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "My Task",
        status: "Done",
        priority: "Normal",
        dueAt,
        archivedAt,
        domain: { id: "d1", displayName: "Web" },
        assignees: [
          { user: { id: "u2", firstName: "Alice", lastName: "Smith" } },
        ],
      },
    ]);
    const out = await runListArchivedTasks("u1", { projectId: "p1" });
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({
      id: "t1",
      title: "My Task",
      status: "Done",
      priority: "Normal",
      dueAt: dueAt.toISOString(),
      archivedAt: archivedAt.toISOString(),
      domain: { id: "d1", name: "Web" },
      assignees: [{ id: "u2", name: "Alice Smith" }],
    });
  });

  it("handles null dueAt and domain", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "t2",
        title: "Undated",
        status: "Cancelled",
        priority: "Low",
        dueAt: null,
        archivedAt: new Date("2026-09-11T00:00:00.000Z"),
        domain: null,
        assignees: [],
      },
    ]);
    const out = await runListArchivedTasks("u1", { projectId: "p1" });
    expect(out.tasks[0]).toMatchObject({
      dueAt: null,
      domain: null,
      assignees: [],
    });
  });

  it("walks keyset pages on archivedAt and id", async () => {
    const row = (id: string, at: string) => ({
      id,
      title: id,
      status: "Done",
      priority: "Normal",
      dueAt: null,
      archivedAt: new Date(at),
      domain: null,
      assignees: [],
    });
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    mockPrisma.task.count.mockResolvedValue(3);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      row("t3", "2026-09-10T00:00:00.000Z"),
      row("t2", "2026-09-10T00:00:00.000Z"),
    ]);
    const first = await runListArchivedTasks("u1", { projectId: "p1", limit: 1 });
    expect(first.tasks.map((t) => t.id)).toEqual(["t3"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 1, total: 3 });

    mockPrisma.task.findMany.mockResolvedValueOnce([row("t2", "2026-09-10T00:00:00.000Z")]);
    const second = await runListArchivedTasks("u1", {
      projectId: "p1",
      limit: 1,
      cursor: first.page.nextCursor!,
    });
    const args = mockPrisma.task.findMany.mock.calls[1][0];
    expect(args.orderBy).toEqual([{ archivedAt: "desc" }, { id: "desc" }]);
    expect(args.where.AND[0]).toEqual({ projectId: "p1", archivedAt: { not: null } });
    expect(args.where.AND[1].OR).toHaveLength(2);
    expect(second.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(second.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("rejects a bad cursor", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: "p1" });
    await expect(
      runListArchivedTasks("u1", { projectId: "p1", cursor: "nope" }),
    ).rejects.toThrow(/Invalid cursor/);
  });
});
