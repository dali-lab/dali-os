import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { requireAuth, requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { currentTerm, isCore } from "~/lib/roles";
import { loader } from "~/projects/routes/api.task-options";

const mockPrisma = prisma as unknown as {
  project: { findMany: ReturnType<typeof vi.fn> };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
};

function get(query = "") {
  const request = new Request(`http://localhost/api/task-options${query}`);
  return loader({ request, params: {} } as never) as Promise<Response>;
}

const person = (id: string, firstName: string, termId: string, sortKey: number) => ({
  termId,
  term: { sortKey },
  user: { id, firstName, lastName: "Park" },
});

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true } as never);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t2" } as never);
  mockPrisma.project.findMany = vi.fn().mockResolvedValue([{ id: "p1", name: "Campus Compost" }]);
  mockPrisma.projectAssignment.findMany = vi.fn().mockResolvedValue([]);
});

describe("GET /api/task-options", () => {
  it("limits members to active projects they're assigned to", async () => {
    const res = await get();
    expect(await res.json()).toEqual({ projects: [{ id: "p1", name: "Campus Compost" }] });
    expect(mockPrisma.project.findMany.mock.calls[0]![0].where).toEqual({
      status: "Active",
      assignments: { some: { userId: "u1" } },
    });
  });

  it("gives Core every active project", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await get();
    expect(mockPrisma.project.findMany.mock.calls[0]![0].where).toEqual({ status: "Active" });
  });

  it("requires a session", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    expect((await get()).status).toBe(401);
  });
});

describe("GET /api/task-options?projectId=", () => {
  it("lists the current term's team once each, sorted", async () => {
    mockPrisma.projectAssignment.findMany = vi.fn().mockResolvedValue([
      person("u2", "Grace", "t2", 2),
      person("u1", "Ada", "t2", 2),
      person("u1", "Ada", "t2", 2),
      person("u3", "Old", "t1", 1),
    ]);
    const res = await get("?projectId=p1");
    expect(await res.json()).toEqual({
      members: [
        { userId: "u1", name: "Ada Park" },
        { userId: "u2", name: "Grace Park" },
      ],
    });
  });

  it("falls back to the latest staffed term", async () => {
    mockPrisma.projectAssignment.findMany = vi.fn().mockResolvedValue([person("u3", "Old", "t1", 1)]);
    const res = await get("?projectId=p1");
    expect(await res.json()).toEqual({ members: [{ userId: "u3", name: "Old Park" }] });
  });

  it("refuses anyone who can't edit the project", async () => {
    vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const res = await get("?projectId=p1");
    expect(res.status).toBe(403);
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
  });
});
