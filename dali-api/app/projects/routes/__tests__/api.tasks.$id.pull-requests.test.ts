import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: { task: { findUnique: vi.fn() }, taskPullRequest: { deleteMany: vi.fn() } },
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/code-tasks.server", () => ({ attachPullRequest: vi.fn() }));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { attachPullRequest } from "~/projects/lib/code-tasks.server";
import { action } from "~/projects/routes/api.tasks.$id.pull-requests";

function call(method: string, body: unknown) {
  const request = new Request("http://localhost/api/tasks/t1/pull-requests", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return action({ request, params: { id: "t1" } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true } as any);
  vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: "t1", projectId: "p1" } as never);
});

describe("/api/tasks/:id/pull-requests", () => {
  it("attaches and returns the PR", async () => {
    const pullRequest = { id: "pr1", repo: "a/b", number: 1, url: "u", title: null, state: "open" };
    vi.mocked(attachPullRequest).mockResolvedValue({ ok: true, pullRequest } as never);
    const res = await call("POST", { url: "https://github.com/a/b/pull/1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pullRequest });
    expect(attachPullRequest).toHaveBeenCalledWith("t1", "https://github.com/a/b/pull/1");
  });

  it("passes attach errors through with their status", async () => {
    vi.mocked(attachPullRequest).mockResolvedValue({ ok: false, status: 400, error: "nope" });
    const res = await call("POST", { url: "x" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("detaches only from this task", async () => {
    expect((await call("DELETE", { pullRequestId: "pr1" })).status).toBe(200);
    expect(prisma.taskPullRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: "pr1", taskId: "t1" },
    });
  });

  it("validates bodies, 404s unknown tasks, and honors the access gate", async () => {
    expect((await call("POST", {})).status).toBe(400);
    expect((await call("DELETE", {})).status).toBe(400);
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(null);
    expect((await call("POST", { url: "x" })).status).toBe(404);
    vi.mocked(requireProjectEditAccess).mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as any);
    expect((await call("POST", { url: "x" })).status).toBe(403);
  });
});
