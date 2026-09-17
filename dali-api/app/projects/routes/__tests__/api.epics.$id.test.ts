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
    count: ReturnType<typeof vi.fn>;
  };
  task: { updateMany: ReturnType<typeof vi.fn> };
  userStory: { deleteMany: ReturnType<typeof vi.fn> };
  epicDependency: {
    deleteMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
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
    update: vi.fn().mockReturnValue("epic-update-op"),
    delete: vi.fn().mockReturnValue("epic-delete-op"),
    count: vi.fn().mockResolvedValue(0),
  };
  mockPrisma.task = { updateMany: vi.fn().mockReturnValue("task-op") };
  mockPrisma.userStory = { deleteMany: vi.fn().mockReturnValue("story-op") };
  mockPrisma.epicDependency = {
    deleteMany: vi.fn().mockReturnValue("dep-clear-op"),
    create: vi.fn((args) => `dep-create-${args.data.dependsOnEpicId}`),
  };
  mockPrisma.$transaction = vi.fn().mockResolvedValue([]);
});

describe("DELETE /api/epics/:id", () => {
  it("unlinks tasks and deletes user stories with the epic", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);

    // Stories must be deleted inside the same transaction as the epic —
    // their FK is ON DELETE RESTRICT, so skipping this 500s (issue #936 review).
    expect(mockPrisma.userStory.deleteMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
    });
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
      data: { epicId: null },
    });
    expect(mockPrisma.epic.delete).toHaveBeenCalledWith({ where: { id: EPIC_ID } });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith([
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

describe("POST /api/epics/:id — dependsOn", () => {
  it("replaces the epic's edges wholesale, in one transaction with the update", async () => {
    mockPrisma.epic.count.mockResolvedValue(2);
    const res = await call("POST", { dependsOn: ["epic-2", "epic-3"] });
    expect(res.status).toBe(200);

    // The clear has to ride in the same transaction as the creates, or a
    // failed create leaves the epic with no dependencies at all.
    expect(mockPrisma.$transaction).toHaveBeenCalledWith([
      "epic-update-op",
      "dep-clear-op",
      "dep-create-epic-2",
      "dep-create-epic-3",
    ]);
    expect(mockPrisma.epicDependency.deleteMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
    });
  });

  it("clears every edge when given an empty list", async () => {
    const res = await call("POST", { dependsOn: [] });
    expect(res.status).toBe(200);
    expect(mockPrisma.epicDependency.deleteMany).toHaveBeenCalledWith({
      where: { epicId: EPIC_ID },
    });
    expect(mockPrisma.epicDependency.create).not.toHaveBeenCalled();
    // No lookup to make: an empty list can't name a target outside the project.
    expect(mockPrisma.epic.count).not.toHaveBeenCalled();
  });

  it("leaves edges alone when dependsOn is absent", async () => {
    const res = await call("POST", { title: "Renamed" });
    expect(res.status).toBe(200);
    expect(mockPrisma.epicDependency.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(["epic-update-op"]);
  });

  it("drops a self-edge rather than writing one", async () => {
    const res = await call("POST", { dependsOn: [EPIC_ID] });
    expect(res.status).toBe(200);
    expect(mockPrisma.epicDependency.create).not.toHaveBeenCalled();
  });

  it("de-duplicates repeated ids", async () => {
    mockPrisma.epic.count.mockResolvedValue(1);
    await call("POST", { dependsOn: ["epic-2", "epic-2"] });
    expect(mockPrisma.epicDependency.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.epic.count).toHaveBeenCalledWith({
      where: { id: { in: ["epic-2"] }, projectId: PROJECT_ID },
    });
  });

  it("400s when a target is not an epic in the same project", async () => {
    // Two ids asked for, only one found in this project.
    mockPrisma.epic.count.mockResolvedValue(1);
    const res = await call("POST", { dependsOn: ["epic-2", "other-project-epic"] });
    expect(res.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("400s when dependsOn is not a list of strings", async () => {
    const res = await call("POST", { dependsOn: [1, 2] });
    expect(res.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not write when the caller lacks project edit access", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as any);
    const res = await call("POST", { dependsOn: ["epic-2"] });
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
