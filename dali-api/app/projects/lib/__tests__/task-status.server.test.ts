import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../github-task-sync", () => ({ closeIssueForTask: vi.fn().mockResolvedValue(undefined), syncIssueForTask: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../task-notifications.server", () => ({ notifyTaskStatusChanged: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { closeIssueForTask, syncIssueForTask } from "../github-task-sync";
import { notifyTaskStatusChanged } from "../task-notifications.server";
import { moveTask, TaskMoveError } from "../task-status.server";

const db = prisma as unknown as {
  task: Record<"findUnique" | "findFirst" | "findMany" | "update", ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
};

function taskRow(over: Record<string, unknown> = {}) {
  return { id: "t1", githubIssueNumber: null, projectId: "p1", status: "Todo", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue(taskRow());
  db.task.findFirst.mockResolvedValue({ position: 4 });
  db.task.update.mockResolvedValue({});
  db.$transaction = vi.fn().mockResolvedValue([]);
});

describe("moveTask", () => {
  it("404s a missing task", async () => {
    db.task.findUnique.mockResolvedValue(null);
    await expect(moveTask({ taskId: "t1", actorId: "u1", status: "Done" })).rejects.toMatchObject({ status: 404 });
  });

  it("appends to the column and stamps activityAt on a status change", async () => {
    const out = await moveTask({ taskId: "t1", actorId: "u1", status: "InProgress" });
    expect(out).toMatchObject({ previousStatus: "Todo", newStatus: "InProgress", position: 5 });
    const data = db.task.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ status: "InProgress", position: 5 });
    expect(data.activityAt).toBeInstanceOf(Date);
  });

  it("leaves activityAt alone when the status is unchanged", async () => {
    await moveTask({ taskId: "t1", actorId: "u1", status: "Todo" });
    expect(db.task.update.mock.calls[0]![0].data).not.toHaveProperty("activityAt");
    expect(notifyTaskStatusChanged).not.toHaveBeenCalled();
  });

  it("honors an explicit position of 0", async () => {
    await moveTask({ taskId: "t1", actorId: "u1", status: "Done", position: 0 });
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(db.task.update.mock.calls[0]![0].data).toMatchObject({ status: "Done", position: 0 });
  });

  it("notifies on a status change, with the actor passed so they are excluded", async () => {
    await moveTask({ taskId: "t1", actorId: "u1", status: "Done" });
    expect(notifyTaskStatusChanged).toHaveBeenCalledWith("t1", "u1", "Done");
  });

  it("closes a linked issue as completed on Done", async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ githubIssueNumber: 7 }));
    await moveTask({ taskId: "t1", actorId: "u1", status: "Done" });
    expect(closeIssueForTask).toHaveBeenCalledWith("t1", "completed");
    expect(syncIssueForTask).not.toHaveBeenCalled();
  });

  it("closes a linked issue as not_planned on Cancelled", async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ githubIssueNumber: 7 }));
    await moveTask({ taskId: "t1", actorId: "u1", status: "Cancelled" });
    expect(closeIssueForTask).toHaveBeenCalledWith("t1", "not_planned");
  });

  it("syncs a linked issue for any other status", async () => {
    db.task.findUnique.mockResolvedValue(taskRow({ githubIssueNumber: 7 }));
    await moveTask({ taskId: "t1", actorId: "u1", status: "InReview" });
    expect(syncIssueForTask).toHaveBeenCalledWith("t1");
    expect(closeIssueForTask).not.toHaveBeenCalled();
  });

  it("makes no GitHub call for an unlinked task", async () => {
    await moveTask({ taskId: "t1", actorId: "u1", status: "Done" });
    expect(closeIssueForTask).not.toHaveBeenCalled();
    expect(syncIssueForTask).not.toHaveBeenCalled();
  });

  it("renumbers orderedIds and only stamps the dragged task", async () => {
    db.task.findMany.mockResolvedValue([{ id: "a", projectId: "p1" }, { id: "t1", projectId: "p1" }]);
    const out = await moveTask({ taskId: "t1", actorId: "u1", status: "Done", orderedIds: ["a", "t1"] });
    expect(out.position).toBe(1);
    const calls = db.task.update.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ where: { id: "a" }, data: { position: 0 } });
    expect(calls[1].data).toMatchObject({ status: "Done", position: 1 });
    expect(calls[1].data.activityAt).toBeInstanceOf(Date);
  });

  it("rejects orderedIds that omit the task", async () => {
    await expect(
      moveTask({ taskId: "t1", actorId: "u1", status: "Done", orderedIds: ["a"] }),
    ).rejects.toMatchObject({ status: 400, message: "orderedIds must include the moved task" });
  });

  it("rejects orderedIds from another project", async () => {
    db.task.findMany.mockResolvedValue([{ id: "a", projectId: "p2" }, { id: "t1", projectId: "p1" }]);
    await expect(
      moveTask({ taskId: "t1", actorId: "u1", status: "Done", orderedIds: ["a", "t1"] }),
    ).rejects.toBeInstanceOf(TaskMoveError);
    expect(db.task.update).not.toHaveBeenCalled();
  });
});
