import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { notifyTaskStatusChanged } from "~/projects/lib/task-notifications.server";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyTaskStatusChanged", () => {
  it("notifies assignees except the actor, with the human status label", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }],
      project: { name: "DALI OS" },
    });

    await notifyTaskStatusChanged("t1", "u1", "InProgress");

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("task.status_changed");
    expect(call.createdByUserId).toBe("u1");
    expect(call.message.title).toBe("Task moved to In progress: Ship it");
    expect(call.message.body).toBe("In DALI OS.");
    expect(call.message.link).toBe("/projects/p1?tab=board&task=t1");
    expect(call.recipients).toEqual([{ userId: "u2" }]);
  });

  it("no-ops when the actor is the only assignee", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }],
      project: { name: "DALI OS" },
    });

    await notifyTaskStatusChanged("t1", "u1", "Done");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("no-ops when the task is gone", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await notifyTaskStatusChanged("t1", "u1", "Done");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("falls back to the raw status when the label is unknown", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u2" }],
      project: { name: "DALI OS" },
    });

    await notifyTaskStatusChanged("t1", "u1", "SomethingNew");

    expect(mockNotify.mock.calls[0][0].message.title).toBe(
      "Task moved to SomethingNew: Ship it",
    );
  });
});
