import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
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
  task: { findMany: ReturnType<typeof vi.fn> };
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
    expect(out).toEqual({ tasks: [] });
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
});
