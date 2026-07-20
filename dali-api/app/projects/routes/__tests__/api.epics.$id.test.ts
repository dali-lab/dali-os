import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action } from "~/projects/routes/api.epics.$id";

const EPIC_ID = "epic-1";
const PROJECT_ID = "proj-1";

const mockPrisma = prisma as unknown as {
  epic: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  sprint: { updateMany: ReturnType<typeof vi.fn> };
  task: { updateMany: ReturnType<typeof vi.fn> };
  userStory: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function call(method: "POST" | "DELETE", body?: unknown) {
  const request = new Request(`http://localhost/api/epics/${EPIC_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return action({ request, params: { id: EPIC_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({
    ok: true,
    userId: "user-1",
  } as any);
  mockPrisma.epic = {
    findUnique: vi.fn().mockResolvedValue({
      id: EPIC_ID,
      startsAt: null,
      endsAt: null,
      projectId: PROJECT_ID,
    }),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockReturnValue("epic-delete-op"),
  };
  mockPrisma.sprint = { updateMany: vi.fn().mockReturnValue("sprint-op") };
  mockPrisma.task = { updateMany: vi.fn().mockReturnValue("task-op") };
  mockPrisma.userStory = { deleteMany: vi.fn().mockReturnValue("story-op") };
  mockPrisma.$transaction = vi.fn().mockResolvedValue([]);
});

describe("DELETE /api/epics/:id", () => {
  it("unlinks sprints/tasks and deletes user stories with the epic", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);

    // Stories must be deleted inside the same transaction as the epic —
    // their FK is ON DELETE RESTRICT, so skipping this 500s (issue #936 review).
    expect(mockPrisma.userStory.deleteMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
    });
    expect(mockPrisma.sprint.updateMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
      data: { epicId: null },
    });
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
      data: { epicId: null },
    });
    expect(mockPrisma.epic.delete).toHaveBeenCalledWith({ where: { id: EPIC_ID } });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith([
      "sprint-op",
      "task-op",
      "story-op",
      "epic-delete-op",
    ]);
  });

  it("404s when the epic does not exist", async () => {
    mockPrisma.epic.findUnique.mockResolvedValue(null);
    const res = await call("DELETE");
    expect(res.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not delete when the caller lacks project edit access", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as any);
    const res = await call("DELETE");
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
