import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runTaskAutoArchive,
  archiveIdleTasks,
  archiveTerminalTasks,
} from "~/jobs/task-auto-archive.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const NOW = new Date("2026-07-20T12:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runTaskAutoArchive", () => {
  it("archives Done/Cancelled tasks idle past the configured threshold", async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 3 });

    const result = await runTaskAutoArchive({
      now: NOW,
      lastSuccessAt: null,
      settings: { archiveAfterDays: 7 },
    });

    expect(result.items).toBe(3);
    expect(mockPrisma.task.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.task.updateMany.mock.calls[0][0];
    // Only unarchived, terminal-status, stale rows are touched...
    expect(arg.where.archivedAt).toBeNull();
    expect(arg.where.status).toEqual({ in: ["Done", "Cancelled"] });
    expect(arg.where.projectId).toBeUndefined();
    // ...where "stale" is now minus the threshold (7 days here).
    const cutoff = arg.where.updatedAt.lt as Date;
    expect(NOW.getTime() - cutoff.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    // ...and it stamps archivedAt with the run's `now`.
    expect(arg.data).toEqual({ archivedAt: NOW });
  });

  it("honors a custom threshold", async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });

    await runTaskAutoArchive({
      now: NOW,
      lastSuccessAt: null,
      settings: { archiveAfterDays: 30 },
    });

    const arg = mockPrisma.task.updateMany.mock.calls[0][0];
    const cutoff = arg.where.updatedAt.lt as Date;
    expect(NOW.getTime() - cutoff.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("reports nothing archived without a note", async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });

    const result = await runTaskAutoArchive({
      now: NOW,
      lastSuccessAt: null,
      settings: { archiveAfterDays: 7 },
    });

    expect(result.items).toBe(0);
    expect(result.note).toBeUndefined();
  });
});

describe("archiveIdleTasks", () => {
  it("scopes to a project when projectId is set", async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });

    const count = await archiveIdleTasks({
      now: NOW,
      archiveAfterDays: 7,
      projectId: "proj-1",
    });

    expect(count).toBe(1);
    const arg = mockPrisma.task.updateMany.mock.calls[0][0];
    expect(arg.where.projectId).toBe("proj-1");
  });
});

describe("archiveTerminalTasks", () => {
  it("archives all Done/Cancelled on the project with no idle cutoff", async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 5 });

    const count = await archiveTerminalTasks({
      now: NOW,
      projectId: "proj-1",
    });

    expect(count).toBe(5);
    const arg = mockPrisma.task.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      projectId: "proj-1",
      archivedAt: null,
      status: { in: ["Done", "Cancelled"] },
    });
    expect(arg.where.updatedAt).toBeUndefined();
    expect(arg.data).toEqual({ archivedAt: NOW });
  });
});
