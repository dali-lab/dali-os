import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../task-notifications.server", () => ({ notifyTaskComment: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/github", () => ({ githubAppClient: vi.fn(), parseRepo: vi.fn(), isNotFound: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { notifyTaskComment } from "../task-notifications.server";
import { addTaskComment } from "../task-comments.server";
import { linkTaskFile, unlinkTaskFile, TaskFileError } from "../task-files.server";
import { unlinkTaskFromGithub } from "../github-task-sync";

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  $transaction: Fn;
  task: { findUnique: Fn; update: Fn };
  taskComment: { create: Fn };
  projectFile: { findUnique: Fn };
  taskFileLink: { createMany: Fn; deleteMany: Fn };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));
  db.task.update.mockResolvedValue({});
});

describe("addTaskComment", () => {
  it("creates the comment, bumps activityAt and notifies", async () => {
    const row = { id: "c1", body: "hi", createdAt: new Date(), author: { id: "u1" } };
    db.taskComment.create.mockResolvedValue(row);
    const out = await addTaskComment({ taskId: "t1", authorId: "u1", body: "hi" });
    expect(out).toBe(row);
    expect(db.taskComment.create.mock.calls[0]![0].data).toEqual({ taskId: "t1", authorId: "u1", body: "hi" });
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { activityAt: expect.any(Date) } });
    expect(notifyTaskComment).toHaveBeenCalledWith({ taskId: "t1", authorId: "u1", body: "hi" });
  });
});

describe("task file links", () => {
  const file = { id: "f1", title: "Spec", projectId: "p1", archivedAt: null, _count: { versions: 2 } };

  beforeEach(() => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    db.projectFile.findUnique.mockResolvedValue(file);
  });

  it("bumps activityAt when a link is created", async () => {
    db.taskFileLink.createMany.mockResolvedValue({ count: 1 });
    const out = await linkTaskFile({ taskId: "t1", fileId: "f1" });
    expect(out).toEqual({ linked: true, file: { id: "f1", title: "Spec", versionCount: 2 } });
    expect(db.task.update).toHaveBeenCalledTimes(1);
  });

  it("does not bump when the file was already linked", async () => {
    db.taskFileLink.createMany.mockResolvedValue({ count: 0 });
    expect((await linkTaskFile({ taskId: "t1", fileId: "f1" })).linked).toBe(false);
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it.each([
    ["archived", { ...file, archivedAt: new Date() }],
    ["from another project", { ...file, projectId: "p2" }],
    ["missing", null],
  ])("404s a file that is %s", async (_n, row) => {
    db.projectFile.findUnique.mockResolvedValue(row);
    await expect(linkTaskFile({ taskId: "t1", fileId: "f1" })).rejects.toBeInstanceOf(TaskFileError);
    expect(db.taskFileLink.createMany).not.toHaveBeenCalled();
  });

  it("bumps on unlink only when a row was removed", async () => {
    db.taskFileLink.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await unlinkTaskFile({ taskId: "t1", fileId: "f1" })).toEqual({ unlinked: true });
    expect(await unlinkTaskFile({ taskId: "t1", fileId: "f1" })).toEqual({ unlinked: false });
    expect(db.task.update).toHaveBeenCalledTimes(1);
  });
});

describe("unlinkTaskFromGithub", () => {
  it("is a no-op for an unlinked task", async () => {
    db.task.findUnique.mockResolvedValue({ githubIssueNumber: null, githubRepo: null });
    expect(await unlinkTaskFromGithub("t1")).toEqual({ noop: true });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("clears the mirror fields, bumps activityAt and returns the previous link", async () => {
    db.task.findUnique.mockResolvedValue({ githubIssueNumber: 42, githubRepo: "dali/alpha" });
    expect(await unlinkTaskFromGithub("t1")).toEqual({
      noop: false,
      previousRepo: "dali/alpha",
      previousIssueNumber: 42,
    });
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null, activityAt: expect.any(Date) },
    });
  });
});
