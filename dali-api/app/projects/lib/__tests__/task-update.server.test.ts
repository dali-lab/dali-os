import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../github-task-sync", () => ({ syncIssueForTask: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../task-notifications.server", () => ({ notifyTaskAssigned: vi.fn().mockResolvedValue(undefined) }));

import { prisma, Prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { syncIssueForTask } from "../github-task-sync";
import { notifyTaskAssigned } from "../task-notifications.server";
import { deleteTask, TaskUpdateError, updateTask } from "../task-update.server";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  $transaction: Fn;
  task: { findUnique: Fn; count: Fn; delete: Fn };
  userStory: { findUnique: Fn };
  epic: { findUnique: Fn };
};

const tx = {
  task: { update: vi.fn() },
  taskAssignee: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  taskDependency: { deleteMany: vi.fn(), createMany: vi.fn() },
};

function baseTask(over: Record<string, unknown> = {}) {
  return { id: "t1", githubIssueNumber: null, projectId: "p1", epicId: null, storyId: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue(baseTask());
  tx.taskAssignee.findMany.mockResolvedValue([]);
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (t: typeof tx) => Promise<unknown>)(tx) : Promise.all(arg as unknown[]),
  );
});

describe("updateTask", () => {
  it("404s a missing task", async () => {
    db.task.findUnique.mockResolvedValue(null);
    await expect(updateTask({ taskId: "t1", actorId: "u1", patch: { title: "x" } })).rejects.toMatchObject({ status: 404 });
  });

  it("is a no-op for an empty patch", async () => {
    expect(await updateTask({ taskId: "t1", actorId: "u1", patch: {} })).toEqual({ noop: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("bumps activityAt with every write", async () => {
    await updateTask({ taskId: "t1", actorId: "u1", patch: { title: "New" } });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { title: "New", activityAt: expect.any(Date) },
    });
  });

  it("writes explicit nulls to clear fields", async () => {
    await updateTask({ taskId: "t1", actorId: "u1", patch: { dueAt: null, description: null } });
    expect(tx.task.update.mock.calls[0]![0].data).toMatchObject({ dueAt: null, description: null });
  });

  it("clears the checklist with the JSON null sentinel", async () => {
    await updateTask({ taskId: "t1", actorId: "u1", patch: { checklist: [] } });
    expect(tx.task.update.mock.calls[0]![0].data.checklist).toBe(Prisma.JsonNull);
  });

  it("lets a story pin its epic over a contradictory epic", async () => {
    db.userStory.findUnique.mockResolvedValue({ epicId: "e-A", epic: { projectId: "p1" } });
    await updateTask({ taskId: "t1", actorId: "u1", patch: { storyId: "s1", epicId: "e-ignored" } });
    expect(tx.task.update.mock.calls[0]![0].data).toMatchObject({ epicId: "e-A", storyId: "s1" });
  });

  it("drops a story that no longer fits a new epic", async () => {
    db.task.findUnique.mockResolvedValue(baseTask({ epicId: "e-A", storyId: "s1" }));
    db.userStory.findUnique.mockResolvedValue({ epicId: "e-A", epic: { projectId: "p1" } });
    db.epic.findUnique.mockResolvedValue({ projectId: "p1" });
    await updateTask({ taskId: "t1", actorId: "u1", patch: { epicId: "e-B" } });
    expect(tx.task.update.mock.calls[0]![0].data).toMatchObject({ epicId: "e-B", storyId: null });
  });

  it("rejects an epic from another project", async () => {
    db.epic.findUnique.mockResolvedValue({ projectId: "other" });
    await expect(updateTask({ taskId: "t1", actorId: "u1", patch: { epicId: "e1" } })).rejects.toMatchObject({
      status: 400,
      message: "Epic is not part of this project",
    });
  });

  it("rejects a story from another project", async () => {
    db.userStory.findUnique.mockResolvedValue({ epicId: "e", epic: { projectId: "other" } });
    await expect(updateTask({ taskId: "t1", actorId: "u1", patch: { storyId: "s1" } })).rejects.toBeInstanceOf(TaskUpdateError);
  });

  it("rejects dependencies outside the project", async () => {
    db.task.count.mockResolvedValue(1);
    await expect(
      updateTask({ taskId: "t1", actorId: "u1", patch: { dependsOnTaskIds: ["a", "b"] } }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid dependency target" });
  });

  it("replaces dependencies, dropping self and duplicates", async () => {
    db.task.count.mockResolvedValue(1);
    await updateTask({ taskId: "t1", actorId: "u1", patch: { dependsOnTaskIds: ["a", "a", "t1"] } });
    expect(tx.taskDependency.createMany).toHaveBeenCalledWith({ data: [{ taskId: "t1", dependsOnTaskId: "a" }] });
  });

  it("notifies only newly added assignees", async () => {
    tx.taskAssignee.findMany.mockResolvedValue([{ userId: "u2" }]);
    await updateTask({ taskId: "t1", actorId: "u1", patch: { assigneeUserIds: ["u2", "u3"] } });
    expect(notifyTaskAssigned).toHaveBeenCalledWith({ taskId: "t1", addedUserIds: ["u3"], actorUserId: "u1" });
  });

  it("syncs a linked task only for fields the issue shows", async () => {
    db.task.findUnique.mockResolvedValue(baseTask({ githubIssueNumber: 5 }));
    await updateTask({ taskId: "t1", actorId: "u1", patch: { startsAt: new Date() } });
    expect(syncIssueForTask).not.toHaveBeenCalled();
    await updateTask({ taskId: "t1", actorId: "u1", patch: { title: "x" } });
    expect(syncIssueForTask).toHaveBeenCalledWith("t1");
  });
});

describe("deleteTask", () => {
  it("404s a missing task", async () => {
    db.task.findUnique.mockResolvedValue(null);
    await expect(deleteTask({ taskId: "t1", actorId: "u1" })).rejects.toMatchObject({ status: 404 });
  });

  it("deletes and audits with the request", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", title: "Ship", projectId: "p1" });
    const request = new Request("http://localhost/x");
    expect(await deleteTask({ taskId: "t1", actorId: "u1", request })).toEqual({ title: "Ship", projectId: "p1" });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "task.delete",
      userId: "u1",
      targetId: "t1",
      metadata: { title: "Ship", projectId: "p1" },
      request,
    });
  });
});
