import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskGithubUpdate,
} from "~/projects/lib/task-notifications.server";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyTaskAssigned", () => {
  it("notifies added assignees, excluding the actor", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      dueAt: null,
      project: { name: "DALI OS" },
    });

    await notifyTaskAssigned({
      taskId: "t1",
      addedUserIds: ["u1", "u2"],
      actorUserId: "u1",
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("task.assigned");
    expect(call.createdByUserId).toBe("u1");
    expect(call.message.title).toBe("Task assigned: Ship it");
    expect(call.message.link).toBe("/projects/p1?tab=board&task=t1");
    expect(call.recipients).toEqual([{ userId: "u2" }]);
  });

  it("no-ops when the only added assignee is the actor", async () => {
    await notifyTaskAssigned({
      taskId: "t1",
      addedUserIds: ["u1"],
      actorUserId: "u1",
    });

    expect(mockPrisma.task.findUnique).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("no-ops when the task is gone", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await notifyTaskAssigned({ taskId: "t1", addedUserIds: ["u2"] });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("notifyTaskComment", () => {
  it("notifies assignees except the author, with a truncated preview", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }],
    });

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "x".repeat(300) });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("task.comment");
    expect(call.recipients).toEqual([{ userId: "u2" }]);
    expect(call.message.body).toHaveLength(201); // 200 chars + ellipsis
    expect(call.message.body.endsWith("…")).toBe(true);
  });

  it("no-ops when the author is the only assignee", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }],
    });

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "hi" });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("notifyTaskGithubUpdate", () => {
  it("tells all assignees when the linked issue closes", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }],
    });

    await notifyTaskGithubUpdate({ taskId: "t1", action: "closed", newStatus: "Done" });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("task.github_update");
    expect(call.message.title).toBe("Task closed from GitHub: Ship it");
    expect(call.message.body).toContain("Done");
    expect(call.recipients).toHaveLength(2);
  });

  it("no-ops when the task has no assignees", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [],
    });

    await notifyTaskGithubUpdate({
      taskId: "t1",
      action: "reopened",
      newStatus: "In progress",
    });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
