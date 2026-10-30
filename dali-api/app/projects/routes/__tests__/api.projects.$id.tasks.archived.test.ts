import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/github-task-sync", () => ({
  createIssueForTask: vi.fn(),
  normalizeRepo: vi.fn(),
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { loader, ARCHIVED_TASKS_PAGE_SIZE } from "~/projects/routes/api.projects.$id.tasks";

const mockPrisma = prisma as unknown as { task: { findMany: ReturnType<typeof vi.fn> } };

function row(n: number) {
  return {
    id: `t${String(n).padStart(3, "0")}`,
    title: `Task ${n}`,
    status: "Done",
    priority: null,
    dueAt: null,
    archivedAt: new Date(Date.UTC(2026, 8, 30, 12, 0, 0) - n * 1000),
    domain: null,
    assignees: [{ user: { id: "u1", firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" } }],
  };
}

function get(query = "") {
  const request = new Request(`http://localhost/api/projects/p1/tasks${query}`);
  return loader({ request, params: { id: "p1" } } as any) as Promise<Response>;
}

describe("GET /api/projects/:id/tasks (archived)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
    mockPrisma.task.findMany.mockResolvedValue([]);
  });

  it("returns the gate response without querying when access is denied", async () => {
    const denied = new Response("no", { status: 403 });
    vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await get()).toBe(denied);
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  it("orders by archivedAt then id and fetches one extra row", async () => {
    await get();
    const args = mockPrisma.task.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ archivedAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(ARCHIVED_TASKS_PAGE_SIZE + 1);
    expect(args.where.AND[0]).toEqual({ projectId: "p1", archivedAt: { not: null } });
    expect(args.where.AND[1]).toEqual({});
  });

  it("keeps the tasks field and has no nextCursor on a short page", async () => {
    mockPrisma.task.findMany.mockResolvedValue([row(1), row(2)]);
    const body = await (await get()).json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["t001", "t002"]);
    expect(body.tasks[0].assignees).toEqual([{ id: "u1", name: "Ada Lovelace" }]);
    expect(body.nextCursor).toBeNull();
  });

  it("trims to one page and returns a cursor at the last kept row", async () => {
    mockPrisma.task.findMany.mockResolvedValue(
      Array.from({ length: ARCHIVED_TASKS_PAGE_SIZE + 1 }, (_, i) => row(i + 1)),
    );
    const body = await (await get()).json();
    expect(body.tasks).toHaveLength(ARCHIVED_TASKS_PAGE_SIZE);
    const last = row(ARCHIVED_TASKS_PAGE_SIZE);
    expect(body.nextCursor).toBe(`${last.archivedAt.toISOString()}|${last.id}`);
  });

  it("applies the cursor as a keyset condition", async () => {
    await get(`?cursor=${encodeURIComponent("2026-09-30T12:00:00.000Z|t010")}`);
    const at = new Date("2026-09-30T12:00:00.000Z");
    expect(mockPrisma.task.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      OR: [{ archivedAt: { lt: at } }, { archivedAt: at, id: { lt: "t010" } }],
    });
  });

  it("reads a malformed cursor as the first page", async () => {
    await get("?cursor=garbage");
    expect(mockPrisma.task.findMany.mock.calls[0][0].where.AND[1]).toEqual({});
  });
});
