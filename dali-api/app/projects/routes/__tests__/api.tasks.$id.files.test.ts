import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action } from "~/projects/routes/api.tasks.$id.files";

const TASK_ID = "task-1";
const CALLER = "user-1";

const mockPrisma = prisma as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  taskFileLink: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

function send(method: "POST" | "DELETE" | "PUT", body?: unknown) {
  const request = new Request(`http://localhost/api/tasks/${TASK_ID}/files`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return action({ request, params: { id: TASK_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({
    ok: true,
    auth: { user: { sub: CALLER } },
  } as any);
  mockPrisma.task.findUnique.mockResolvedValue({ id: TASK_ID, projectId: "p1" });
  mockPrisma.taskFileLink.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.taskFileLink.deleteMany.mockResolvedValue({ count: 1 });
  mockPrisma.projectFile.findUnique.mockResolvedValue({
    id: "f1",
    title: "Poster draft",
    projectId: "p1",
    archivedAt: null,
    _count: { versions: 3 },
  });
});

describe("POST /api/tasks/:id/files", () => {
  it("links a project file and returns the artifact shape", async () => {
    const res = (await send("POST", { fileId: "f1" })) as Response;

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "f1", title: "Poster draft", versionCount: 3 });
    expect(mockPrisma.taskFileLink.createMany).toHaveBeenCalledWith({
      data: [{ taskId: TASK_ID, fileId: "f1" }],
      skipDuplicates: true,
    });
  });

  it("stamps activityAt so the board flags the task as updated", async () => {
    await send("POST", { fileId: "f1" });

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { activityAt: expect.any(Date) },
    });
  });

  it("leaves activityAt alone when the file was already linked", async () => {
    mockPrisma.taskFileLink.createMany.mockResolvedValue({ count: 0 });

    await send("POST", { fileId: "f1" });

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("rejects a file from another project", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      title: "Other",
      projectId: "p2",
      archivedAt: null,
      _count: { versions: 1 },
    });

    const res = (await send("POST", { fileId: "f1" })) as Response;

    expect(res.status).toBe(404);
    expect(mockPrisma.taskFileLink.createMany).not.toHaveBeenCalled();
  });

  it("rejects an archived file", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      id: "f1",
      title: "Old",
      projectId: "p1",
      archivedAt: new Date(),
      _count: { versions: 1 },
    });

    const res = (await send("POST", { fileId: "f1" })) as Response;

    expect(res.status).toBe(404);
  });

  it("404s on an unknown task", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = (await send("POST", { fileId: "f1" })) as Response;

    expect(res.status).toBe(404);
  });

  it("passes the gate's response through when access is denied", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: denied,
    } as any);

    const res = (await send("POST", { fileId: "f1" })) as Response;

    expect(res.status).toBe(403);
    expect(mockPrisma.taskFileLink.createMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/tasks/:id/files", () => {
  it("unlinks without touching the file", async () => {
    const res = (await send("DELETE", { fileId: "f1" })) as Response;

    expect(res.status).toBe(200);
    expect(mockPrisma.taskFileLink.deleteMany).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, fileId: "f1" },
    });
  });

  it("stamps activityAt when a link was actually removed", async () => {
    await send("DELETE", { fileId: "f1" });

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { activityAt: expect.any(Date) },
    });
  });

  it("leaves activityAt alone when nothing was linked", async () => {
    mockPrisma.taskFileLink.deleteMany.mockResolvedValue({ count: 0 });

    await send("DELETE", { fileId: "f1" });

    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});

it("rejects unsupported methods", async () => {
  const res = (await send("PUT", { fileId: "f1" })) as Response;
  expect(res.status).toBe(405);
});
