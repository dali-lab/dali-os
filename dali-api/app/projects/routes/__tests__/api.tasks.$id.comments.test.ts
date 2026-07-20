import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskComment: vi.fn().mockResolvedValue(undefined),
}));

import { requireMemberSession } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { notifyTaskComment } from "~/projects/lib/task-notifications.server";
import { loader, action } from "~/projects/routes/api.tasks.$id.comments";

const TASK_ID = "task-1";
const CALLER = "user-1";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn> };
  taskComment: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function get() {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}/comments`);
  return loader({ request, params: { id: TASK_ID } } as any);
}

function post(body: unknown) {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: TASK_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: CALLER } },
  } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  mockPrisma.task = {
    findUnique: vi.fn().mockResolvedValue({
      id: TASK_ID,
      assignees: [{ userId: CALLER }],
    }),
  };
  mockPrisma.taskComment = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: "comment-1",
      body: "hello",
      createdAt: new Date("2026-07-20T12:00:00Z"),
      author: { id: CALLER, firstName: "Ada", lastName: "Lovelace" },
    }),
  };
});

describe("GET /api/tasks/:id/comments", () => {
  it("returns comments oldest-first with author name flattened", async () => {
    mockPrisma.taskComment.findMany.mockResolvedValue([
      {
        id: "c1",
        body: "first",
        createdAt: new Date("2026-07-19T09:00:00Z"),
        author: { id: "u2", firstName: "Grace", lastName: "Hopper" },
      },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      comments: [
        {
          id: "c1",
          body: "first",
          createdAt: "2026-07-19T09:00:00.000Z",
          author: { id: "u2", name: "Grace Hopper" },
        },
      ],
    });
    expect(mockPrisma.taskComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("404s when the task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("rejects a blank body", async () => {
    const res = await post({ body: "   " });
    expect(res.status).toBe(400);
    expect(mockPrisma.taskComment.create).not.toHaveBeenCalled();
  });

  it("rejects an over-long body", async () => {
    const res = await post({ body: "x".repeat(10_001) });
    expect(res.status).toBe(400);
    expect(mockPrisma.taskComment.create).not.toHaveBeenCalled();
  });

  it("forbids callers who are neither assignee nor Core", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      assignees: [{ userId: "someone-else" }],
    });
    const res = await post({ body: "hi" });
    expect(res.status).toBe(403);
    expect(mockPrisma.taskComment.create).not.toHaveBeenCalled();
    expect(notifyTaskComment).not.toHaveBeenCalled();
  });

  it("lets an assignee comment and dispatches the task.comment event", async () => {
    const res = await post({ body: "  hello  " });
    expect(res.status).toBe(200);
    expect(mockPrisma.taskComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { taskId: TASK_ID, authorId: CALLER, body: "hello" },
      }),
    );
    expect(notifyTaskComment).toHaveBeenCalledWith({
      taskId: TASK_ID,
      authorId: CALLER,
      body: "hello",
    });
    expect(await res.json()).toEqual({
      id: "comment-1",
      body: "hello",
      createdAt: "2026-07-20T12:00:00.000Z",
      author: { id: CALLER, name: "Ada Lovelace" },
    });
  });

  it("lets a Core non-assignee comment", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      assignees: [{ userId: "someone-else" }],
    });
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await post({ body: "core says hi" });
    expect(res.status).toBe(200);
    expect(mockPrisma.taskComment.create).toHaveBeenCalled();
  });

  it("404s when the task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await post({ body: "hi" });
    expect(res.status).toBe(404);
  });
});
