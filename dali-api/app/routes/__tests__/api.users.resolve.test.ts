import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (v: string | null) => v),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { loader } from "~/routes/api.users.resolve";

const mockPrisma = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
};

function get(ids: string) {
  const url = new URL(`http://localhost/api/users/resolve?ids=${ids}`);
  return loader({ request: new Request(url), params: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "caller", type: "member" },
  } as any);
  mockPrisma.user.findMany.mockResolvedValue([]);
});

describe("GET /api/users/resolve", () => {
  it("returns empty users when ids is empty", async () => {
    const res = (await get("")) as Response;
    const data = await res.json();
    expect(data.users).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("returns resolved users for valid ids", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Alice", lastName: "Smith", photoUrl: null },
      { id: "u2", firstName: "Bob", lastName: "", photoUrl: "https://example.com/bob.jpg" },
    ]);
    const res = (await get("u1,u2")) as Response;
    const data = await res.json();
    expect(data.users).toHaveLength(2);
    expect(data.users[0]).toMatchObject({ id: "u1", name: "Alice Smith", photoUrl: null });
    expect(data.users[1]).toMatchObject({ id: "u2", name: "Bob", photoUrl: "https://example.com/bob.jpg" });
  });

  it("silently omits ids not found in the database", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Alice", lastName: "Smith", photoUrl: null },
    ]);
    const res = (await get("u1,missing-id")) as Response;
    const data = await res.json();
    expect(data.users).toHaveLength(1);
    expect(data.users[0].id).toBe("u1");
  });

  it("caps at 50 ids (passes at most 50 to the DB)", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u${i}`).join(",");
    await get(ids);
    const call = mockPrisma.user.findMany.mock.calls[0][0];
    expect(call.where.id.in).toHaveLength(50);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    } as any);
    const res = (await get("u1")) as Response;
    expect(res.status).toBe(401);
  });

  it("passes only non-empty trimmed ids to the DB query", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await get(" u1 , , u2 ");
    const call = mockPrisma.user.findMany.mock.calls[0][0];
    // After trim+filter, only "u1" and "u2" survive
    expect(call.where.id.in).toEqual(["u1", "u2"]);
  });
});
