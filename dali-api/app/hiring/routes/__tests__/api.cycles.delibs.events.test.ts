import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn() }));
vi.mock("~/lib/sse.server", () => ({
  busEventStream: vi.fn(() => new Response("stream")),
}));

import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { busEventStream } from "~/lib/sse.server";
import { loader } from "~/hiring/routes/api.cycles.$cycleId.delibs.events";

const call = () => {
  const request = new Request("http://test/api/hiring/cycles/c1/delibs/events");
  return { request, res: loader({ request, params: { cycleId: "c1" } } as any) };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "user-ada" } } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
});

describe("GET /api/hiring/cycles/:cycleId/delibs/events", () => {
  it("401s a signed-out caller without opening a stream", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as any);
    const res = await call().res;
    expect(res.status).toBe(401);
    expect(busEventStream).not.toHaveBeenCalled();
  });

  it("403s a caller without access to the cycle", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    const res = await call().res;
    expect(res.status).toBe(403);
    expect(hasCycleAccess).toHaveBeenCalledWith("user-ada", "c1");
    expect(busEventStream).not.toHaveBeenCalled();
  });

  it("streams the cycle's delibs topic with a one-minute sync", async () => {
    const { request, res } = call();
    expect(await (await res).text()).toBe("stream");
    expect(busEventStream).toHaveBeenCalledWith(request, ["delibs:c1"], { syncMs: 60_000 });
  });
});
