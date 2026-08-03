import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/projects/lib/project-members.server", () => ({
  currentProjectParticipantIds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskGithubUpdate,
} from "~/projects/lib/task-notifications.server";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  // Read by resolveHandles when a comment body carries "@handle" tokens.
  user: { findMany: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockMembers = currentProjectParticipantIds as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: everyone referenced in these tests is currently on the project.
  // Individual tests override this to exercise the roll-off gate.
  mockMembers.mockResolvedValue(new Set(["u1", "u2"]));
  // Default: no handle resolves. Mention tests override.
  mockPrisma.user.findMany.mockResolvedValue([]);
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

  it("excludes an assignee who has rolled off the project", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }, { userId: "gone" }],
    });
    // "gone" is a historical assignee but no longer on the project.
    mockMembers.mockResolvedValue(new Set(["u1", "u2"]));

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "hi" });

    expect(currentProjectParticipantIds).toHaveBeenCalledWith("p1");
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0].recipients).toEqual([{ userId: "u2" }]);
  });

  it("no-ops when every remaining assignee has left the project", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u2" }],
    });
    mockMembers.mockResolvedValue(new Set(["u1"]));

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "hi" });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("notifies an @mentioned member who is neither assignee nor on the project", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }],
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u3" }]);

    await notifyTaskComment({
      taskId: "t1",
      authorId: "u1",
      body: "@sophie can you take a look?",
    });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { handle: { in: ["sophie"] } } }),
    );
    const byEvent = Object.fromEntries(
      mockNotify.mock.calls.map((c) => [c[0].eventType, c[0]]),
    );
    expect(byEvent["task.comment"].recipients).toEqual([{ userId: "u2" }]);
    expect(byEvent["pagedoc.mention"].recipients).toEqual([{ userId: "u3" }]);
    expect(byEvent["pagedoc.mention"].message.title).toBe(
      "You were mentioned on: Ship it",
    );
    expect(byEvent["pagedoc.mention"].message.link).toBe(
      "/projects/p1?tab=board&task=t1",
    );
  });

  it("sends a mentioned assignee the mention instead of the comment event", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }, { userId: "u2" }],
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u2" }]);

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "@u2handle ping" });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0].eventType).toBe("pagedoc.mention");
    expect(mockNotify.mock.calls[0][0].recipients).toEqual([{ userId: "u2" }]);
  });

  it("ignores an author who mentions themselves", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: "t1",
      title: "Ship it",
      projectId: "p1",
      assignees: [{ userId: "u1" }],
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }]);

    await notifyTaskComment({ taskId: "t1", authorId: "u1", body: "note to @self" });

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
