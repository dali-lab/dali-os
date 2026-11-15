import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../github-task-sync", () => ({
  createIssueForTask: vi.fn().mockResolvedValue(undefined),
  normalizeRepo: (s: string) => (s.includes("/") && !s.includes(" ") ? s : null),
}));
vi.mock("../task-notifications.server", () => ({ notifyTaskAssigned: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../task-position.server", () => ({ nextColumnPosition: vi.fn().mockResolvedValue(3) }));

import { mockedPrisma } from "~/test-utils/prisma";
import { createIssueForTask } from "../github-task-sync";
import { notifyTaskAssigned } from "../task-notifications.server";
import { nextColumnPosition } from "../task-position.server";
import { createTask, TaskCreateError } from "../task-create.server";

const db = mockedPrisma();
const create = vi.fn();
const createMany = vi.fn();
const base = { projectId: "p1", actorId: "u1", title: "Send scope" };

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: "t1" });
  db.project.findUnique.mockResolvedValue({ id: "p1", repoUrls: ["example/repo"] } as never);
  db.userStory.findUnique.mockResolvedValue(null);
  db.epic.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ task: { create }, taskAssignee: { createMany } }),
  );
});

const data = () => create.mock.calls[0][0].data;

describe("createTask status rule", () => {
  it.each([
    ["no status, no dueAt", {}, "Backlog"],
    ["no status, a dueAt", { dueAt: new Date("2026-12-01") }, "Todo"],
    ["explicit Todo, no dueAt", { status: "Todo" }, "Todo"],
    ["explicit InProgress, no dueAt", { status: "InProgress" }, "InProgress"],
  ])("%s lands in %s", async (_n, extra, expected) => {
    const out = await createTask({ ...base, ...extra });
    expect(out).toEqual({ id: "t1", status: expected, position: 3 });
    expect(nextColumnPosition).toHaveBeenCalledWith("p1", expected);
    expect(data()).toMatchObject({ status: expected, position: 3, createdById: "u1" });
  });

  it("rejects a blank title and an unknown status without writing", async () => {
    await expect(createTask({ ...base, title: "  " })).rejects.toMatchObject({ status: 400, message: "Title is required" });
    await expect(createTask({ ...base, status: "Nope" })).rejects.toMatchObject({ status: 400, message: "Invalid status" });
    expect(create).not.toHaveBeenCalled();
  });

  it("404s on a missing project", async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(createTask(base)).rejects.toMatchObject({ status: 404 });
  });
});

describe("createTask fields", () => {
  it("trims the title, nulls a blank description and keeps optional fields off the row when unset", async () => {
    await createTask({ ...base, title: "  Send scope ", description: "   " });
    expect(data()).toEqual({
      projectId: "p1",
      title: "Send scope",
      description: null,
      status: "Backlog",
      position: 3,
      epicId: null,
      storyId: null,
      dueAt: null,
      startsAt: null,
      createdById: "u1",
    });
  });

  it("stores priority, domain and source recording when given", async () => {
    await createTask({ ...base, priority: "High", domainId: "d1", sourceRecordingId: "rec1" });
    expect(data()).toMatchObject({ priority: "High", domainId: "d1", sourceRecordingId: "rec1" });
  });

  it("assigns and notifies assignees", async () => {
    await createTask({ ...base, assigneeUserIds: ["u2", "u3"] });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: "t1", userId: "u2" }, { taskId: "t1", userId: "u3" }],
      skipDuplicates: true,
    });
    expect(notifyTaskAssigned).toHaveBeenCalledWith({ taskId: "t1", addedUserIds: ["u2", "u3"], actorUserId: "u1" });
  });

  it("does not notify when nobody is assigned", async () => {
    await createTask(base);
    expect(createMany).not.toHaveBeenCalled();
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
  });
});

describe("createTask epic and story", () => {
  it("derives the epic from the story and ignores epicId", async () => {
    db.userStory.findUnique.mockResolvedValue({ epicId: "e-story", epic: { projectId: "p1" } } as never);
    await createTask({ ...base, storyId: "s1", epicId: "e-other" });
    expect(data()).toMatchObject({ storyId: "s1", epicId: "e-story" });
    expect(db.epic.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["a story from another project", () => db.userStory.findUnique.mockResolvedValue({ epicId: "e", epic: { projectId: "x" } } as never), { storyId: "s1" }],
    ["an unknown story", () => db.userStory.findUnique.mockResolvedValue(null), { storyId: "s1" }],
    ["an epic from another project", () => db.epic.findUnique.mockResolvedValue({ projectId: "x" } as never), { epicId: "e1" }],
    ["an unknown epic", () => db.epic.findUnique.mockResolvedValue(null), { epicId: "e1" }],
  ])("rejects %s", async (_n, arrange, extra) => {
    arrange();
    await expect(createTask({ ...base, ...extra })).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("links a story-less task to an epic of this project", async () => {
    db.epic.findUnique.mockResolvedValue({ projectId: "p1" } as never);
    await createTask({ ...base, epicId: "e1" });
    expect(data()).toMatchObject({ epicId: "e1", storyId: null });
  });
});

describe("createTask GitHub mirror", () => {
  it("mirrors to a repo the project declares", async () => {
    await createTask({ ...base, mirrorToGithubRepo: "example/repo" });
    expect(createIssueForTask).toHaveBeenCalledWith("t1", "example/repo");
  });

  it("rejects a malformed repo and one the project does not declare", async () => {
    await expect(createTask({ ...base, mirrorToGithubRepo: "not a repo" })).rejects.toBeInstanceOf(TaskCreateError);
    await expect(createTask({ ...base, mirrorToGithubRepo: "someone/else" })).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not mirror by default", async () => {
    await createTask(base);
    expect(createIssueForTask).not.toHaveBeenCalled();
  });
});
