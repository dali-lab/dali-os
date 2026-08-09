import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/github-task-sync", () => ({ syncIssueForTask: vi.fn() }));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma, Prisma } from "~/lib/db";
import { action } from "~/projects/routes/api.tasks.$id";

const TASK_ID = "task-1";
const PROJECT_ID = "proj-1";

const mockPrisma = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  sprint: { findUnique: ReturnType<typeof vi.fn> };
  epic: { findUnique: ReturnType<typeof vi.fn> };
  taskAssignee: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  taskComment: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function call(method: "PATCH" | "DELETE", body?: unknown) {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return action({ request, params: { id: TASK_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "user-1" } },
  } as any);
  mockPrisma.task = {
    findUnique: vi.fn().mockResolvedValue({
      id: TASK_ID,
      githubIssueNumber: null,
      projectId: PROJECT_ID,
    }),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockReturnValue("task-delete-op"),
  };
  mockPrisma.sprint = { findUnique: vi.fn() };
  mockPrisma.epic = { findUnique: vi.fn() };
  mockPrisma.taskAssignee = {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockReturnValue("assignee-delete-op"),
  };
  mockPrisma.taskComment = { deleteMany: vi.fn().mockReturnValue("comment-delete-op") };
  // Array form (DELETE) resolves the batch; callback form (PATCH) runs the
  // callback against the same mock client.
  mockPrisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => unknown)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("PATCH /api/tasks/:id sprint", () => {
  it("rejects a sprint that belongs to another project", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({ projectId: "other-project" });
    const res = await call("PATCH", { sprintId: "sprint-9" });
    expect(res.status).toBe(400);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown sprint", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue(null);
    const res = await call("PATCH", { sprintId: "nope" });
    expect(res.status).toBe(400);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("writes a sprint from the task's own project", async () => {
    mockPrisma.sprint.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    const res = await call("PATCH", { sprintId: "sprint-1" });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { sprintId: "sprint-1", activityAt: expect.any(Date) },
    });
  });

  it("moves to backlog on null without a sprint lookup", async () => {
    const res = await call("PATCH", { sprintId: null });
    expect(res.status).toBe(200);
    expect(mockPrisma.sprint.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { sprintId: null, activityAt: expect.any(Date) },
    });
  });
});

describe("PATCH /api/tasks/:id epic", () => {
  it("rejects an epic that belongs to another project", async () => {
    mockPrisma.epic.findUnique.mockResolvedValue({ projectId: "other-project" });
    const res = await call("PATCH", { epicId: "epic-9" });
    expect(res.status).toBe(400);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("writes an epic from the task's own project", async () => {
    mockPrisma.epic.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
    const res = await call("PATCH", { epicId: "epic-1" });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { epicId: "epic-1", activityAt: expect.any(Date) },
    });
  });
});

describe("PATCH /api/tasks/:id checklist", () => {
  it("rejects a malformed item", async () => {
    const res = await call("PATCH", { checklist: [{ text: 5 }] });
    expect(res.status).toBe(400);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects over-long item text", async () => {
    const res = await call("PATCH", { checklist: [{ text: "x".repeat(501) }] });
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 items", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ text: `item ${i}` }));
    const res = await call("PATCH", { checklist: items });
    expect(res.status).toBe(400);
  });

  it("normalizes items: trims, coerces done, drops empties", async () => {
    const res = await call("PATCH", {
      checklist: [
        { text: "  write tests  ", done: true },
        { text: "   " },
        { text: "ship it" },
      ],
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: {
        checklist: [
          { text: "write tests", done: true },
          { text: "ship it", done: false },
        ],
        activityAt: expect.any(Date),
      },
    });
  });

  it("clears the column with the JsonNull sentinel on null", async () => {
    const res = await call("PATCH", { checklist: null });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { checklist: Prisma.JsonNull, activityAt: expect.any(Date) },
    });
  });

  it("clears the column when every item normalizes away", async () => {
    const res = await call("PATCH", { checklist: [{ text: "   " }] });
    expect(res.status).toBe(200);
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { checklist: Prisma.JsonNull, activityAt: expect.any(Date) },
    });
  });
});

describe("DELETE /api/tasks/:id", () => {
  it("removes assignees and comments before the task, in one transaction", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(mockPrisma.taskAssignee.deleteMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID },
    });
    expect(mockPrisma.taskComment.deleteMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID },
    });
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: TASK_ID } });
    // Order matters: assignee/comment FKs are RESTRICT, so they precede the
    // task row inside the batch.
    expect(mockPrisma.$transaction).toHaveBeenCalledWith([
      "assignee-delete-op",
      "comment-delete-op",
      "task-delete-op",
    ]);
  });

  it("404s when the task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await call("DELETE");
    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("stops at the edit-access gate", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as any);
    const res = await call("DELETE");
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
