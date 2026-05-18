import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => {
  const sprintFindUnique = vi.fn();
  const sprintFindFirst = vi.fn();
  const sprintUpdate = vi.fn();
  const taskUpdateMany = vi.fn();
  const tx = {
    sprint: {
      findUnique: sprintFindUnique,
      findFirst: sprintFindFirst,
      update: sprintUpdate,
    },
    task: { updateMany: taskUpdateMany },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      sprint: tx.sprint,
      task: tx.task,
    },
  };
});

import { prisma } from "~/lib/db";
import { closeSprint, SprintCloseError } from "../lib/sprintClose";

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  sprint: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  task: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  mockPrisma.sprint.findUnique.mockReset();
  mockPrisma.sprint.findFirst.mockReset();
  mockPrisma.sprint.update.mockReset().mockResolvedValue({});
  mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("closeSprint", () => {
  it("rejects when sprint is missing", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue(null);
    await expect(closeSprint("s1", "backlog")).rejects.toBeInstanceOf(
      SprintCloseError,
    );
  });

  it("rejects when sprint is already closed", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      projectId: "p1",
      status: "Closed",
    });
    await expect(closeSprint("s1", "backlog")).rejects.toBeInstanceOf(
      SprintCloseError,
    );
  });

  it("moves open tasks to backlog (sprintId=null)", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      projectId: "p1",
      status: "Active",
    });
    mockPrisma.task.updateMany.mockResolvedValue({ count: 3 });

    const result = await closeSprint("s1", "backlog");

    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        sprintId: "s1",
        status: { in: ["Todo", "InProgress", "InReview"] },
      },
      data: { sprintId: null },
    });
    expect(result.movedTaskCount).toBe(3);
    expect(result.destinationSprintId).toBeNull();
    expect(mockPrisma.sprint.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "Closed" },
    });
  });

  it("moves open tasks into the next Planned/Active sprint", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      projectId: "p1",
      status: "Active",
    });
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "s2" });
    mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });

    const result = await closeSprint("s1", "nextSprint");

    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        sprintId: "s1",
        status: { in: ["Todo", "InProgress", "InReview"] },
      },
      data: { sprintId: "s2" },
    });
    expect(result.destinationSprintId).toBe("s2");
  });

  it("rejects nextSprint when no other Planned/Active sprint exists", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      projectId: "p1",
      status: "Active",
    });
    mockPrisma.sprint.findFirst.mockResolvedValue(null);
    await expect(closeSprint("s1", "nextSprint")).rejects.toBeInstanceOf(
      SprintCloseError,
    );
  });

  it("never touches Done or Cancelled tasks", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({
      id: "s1",
      projectId: "p1",
      status: "Active",
    });
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });

    await closeSprint("s1", "backlog");

    const call = mockPrisma.task.updateMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(["Todo", "InProgress", "InReview"]);
    expect(call.where.status.in).not.toContain("Done");
    expect(call.where.status.in).not.toContain("Cancelled");
  });
});
