import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: {
    task: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/github-task-sync", () => ({
  closeIssueForTask: vi.fn().mockResolvedValue(undefined),
  syncIssueForTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskStatusChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/projects/lib/sprints.server", () => ({ checkSprintTarget: vi.fn().mockResolvedValue(null) }));
vi.mock("~/projects/lib/code-tasks.server", () => ({ codeTaskDoneBlocker: vi.fn() }));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkSprintTarget } from "~/projects/lib/sprints.server";
import { codeTaskDoneBlocker } from "~/projects/lib/code-tasks.server";
import { action } from "~/projects/routes/api.tasks.$id.move";

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  githubIssueNumber: null,
  projectId: "p1",
  status: "InReview",
  sprintId: "s1",
  sprint: { closedAt: null },
  ...over,
});

function move(body: unknown) {
  const request = new Request("http://localhost/api/tasks/t1/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: "t1" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  vi.mocked(prisma.task.findUnique).mockResolvedValue(task() as never);
  vi.mocked(codeTaskDoneBlocker).mockResolvedValue(null);
});

describe("POST /api/tasks/:id/move", () => {
  it("refuses Done for a code task without a merged PR", async () => {
    vi.mocked(codeTaskDoneBlocker).mockResolvedValue("attach a merged PR");
    const res = await move({ status: "Done", position: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "attach a merged PR" });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("moves to Done once the guard clears", async () => {
    const res = await move({ status: "Done", position: 3 });
    expect(res.status).toBe(200);
    expect(codeTaskDoneBlocker).toHaveBeenCalledWith("t1", expect.any(Request));
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Done", position: 3 }) }),
    );
  });

  it("only checks the guard on the transition into Done", async () => {
    await move({ status: "InProgress", position: 0 });
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task({ status: "Done" }) as never);
    await move({ status: "Done", position: 1 });
    expect(codeTaskDoneBlocker).not.toHaveBeenCalled();
  });

  it("rejects the retired Backlog status", async () => {
    expect((await move({ status: "Backlog", position: 0 })).status).toBe(400);
  });

  it("changes sprint after validating the target", async () => {
    await move({ status: "InReview", position: 0, sprintId: "s2" });
    expect(checkSprintTarget).toHaveBeenCalledWith("p1", "s2");
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sprintId: "s2" }) }),
    );
    vi.mocked(checkSprintTarget).mockResolvedValueOnce({ error: "That sprint is closed" });
    expect((await move({ status: "InReview", position: 0, sprintId: "old" })).status).toBe(400);
  });

  it("freezes a closed sprint's tasks, except moving unfinished work out", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task({ sprint: { closedAt: new Date() } }) as never);
    expect((await move({ status: "Done", position: 0 })).status).toBe(409);
    expect((await move({ status: "InReview", position: 0, sprintId: null })).status).toBe(200);
  });
});
