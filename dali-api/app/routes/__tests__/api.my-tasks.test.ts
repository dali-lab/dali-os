import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/tasks", () => ({
  listOpenTasksPage: vi.fn(),
  listMyProjectTasksPage: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { listOpenTasksPage, listMyProjectTasksPage } from "~/lib/tasks";
import { loader } from "~/routes/api.my-tasks";

const call = (query: string) =>
  loader({ request: new Request(`http://localhost/api/my-tasks${query}`) } as any) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "user-1" } } as any);
  vi.mocked(listOpenTasksPage).mockResolvedValue({ items: [{ id: "t1" }], nextCursor: "c" } as any);
  vi.mocked(listMyProjectTasksPage).mockResolvedValue({ items: [{ id: "p1" }], nextCursor: "100" } as any);
});

describe("GET /api/my-tasks", () => {
  it("returns the auth response when signed out and reads nothing", async () => {
    const denied = new Response(null, { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await call("?kind=open")).toBe(denied);
    expect(listOpenTasksPage).not.toHaveBeenCalled();
    expect(listMyProjectTasksPage).not.toHaveBeenCalled();
  });

  it("pages the open list for the signed-in user with the cursor", async () => {
    const res = await call("?kind=open&cursor=abc");
    expect(await res.json()).toEqual({ items: [{ id: "t1" }], nextCursor: "c" });
    expect(listOpenTasksPage).toHaveBeenCalledWith("user-1", expect.objectContaining({ cursor: "abc" }));
  });

  it("pages project work by offset cursor", async () => {
    const res = await call("?kind=project&cursor=50");
    expect(await res.json()).toEqual({ items: [{ id: "p1" }], nextCursor: "100" });
    expect(listMyProjectTasksPage).toHaveBeenCalledWith("user-1", { cursor: "50" });
  });

  it("rejects an unknown kind", async () => {
    expect((await call("?kind=other")).status).toBe(400);
    expect((await call("")).status).toBe(400);
  });
});
