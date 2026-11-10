import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/github-task-sync", () => ({ closeIssueForTask: vi.fn(), syncIssueForTask: vi.fn() }));
vi.mock("~/projects/lib/task-notifications.server", () => ({
  notifyTaskStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action } from "~/projects/routes/api.tasks.$id.move";

const mockTask = (prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
}).task;

function move(body: unknown) {
  const request = new Request("http://localhost/api/tasks/t1/move", { method: "POST", body: JSON.stringify(body) });
  return action({ request, params: { id: "t1" } } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  mockTask.findUnique = vi.fn().mockResolvedValue({ id: "t1", githubIssueNumber: null, projectId: "p1", status: "Todo" });
  mockTask.findFirst = vi.fn().mockResolvedValue({ position: 4 });
  mockTask.update = vi.fn().mockResolvedValue({});
});

describe("POST /api/tasks/:id/move", () => {
  it("appends to the column when only a status is sent", async () => {
    expect((await move({ status: "Done" })).status).toBe(200);
    expect(mockTask.findFirst.mock.calls[0]![0].where).toEqual({ projectId: "p1", status: "Done" });
    expect(mockTask.update.mock.calls[0]![0].data).toMatchObject({ status: "Done", position: 5 });
  });

  it("starts an empty column at zero", async () => {
    mockTask.findFirst = vi.fn().mockResolvedValue(null);
    await move({ status: "Done" });
    expect(mockTask.update.mock.calls[0]![0].data).toMatchObject({ position: 0 });
  });

  it("keeps honoring an explicit position", async () => {
    await move({ status: "Done", position: 2 });
    expect(mockTask.findFirst).not.toHaveBeenCalled();
    expect(mockTask.update.mock.calls[0]![0].data).toMatchObject({ position: 2 });
  });

  it("rejects a position that isn't a number", async () => {
    expect((await move({ status: "Done", position: "2" })).status).toBe(400);
  });
});
