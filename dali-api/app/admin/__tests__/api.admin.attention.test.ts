import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/admin/lib/attention.server", () => ({ loadAdminAttention: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loadAdminAttention } from "~/admin/lib/attention.server";
import { loader } from "~/admin/routes/api.admin.attention";

const run = () =>
  loader({ request: new Request("http://localhost/api/admin/attention"), params: {}, context: {} } as never) as Promise<unknown>;

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/attention", () => {
  it("rejects signed-out requests", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect(((await run()) as Response).status).toBe(401);
  });

  it("rejects members outside Core", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(false);
    expect(((await run()) as Response).status).toBe(403);
    expect(loadAdminAttention).not.toHaveBeenCalled();
  });

  it("returns only the counts to Core members", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(loadAdminAttention).mockResolvedValue({
      counts: { messaging: 2, platform: 1 },
      items: [{ key: "x" }] as never,
    });
    expect(await run()).toEqual({ counts: { messaging: 2, platform: 1 } });
  });
});
