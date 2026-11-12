import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { archiveTerminalTasks } from "~/projects/lib/task-archive.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const NOW = new Date("2026-07-20T12:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
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
