import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/core/coreNav", () => ({ coreHandle: vi.fn(() => ({})) }));

import { requireAuth } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { loader } from "../core.drive-folders";

const run = () => loader({ request: new Request("http://x/core/drive-folders") } as never);

describe("core.drive-folders loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isAdmin).mockResolvedValue(false);
  });

  it("returns the Core process id and whether the viewer is an admin", async () => {
    expect(await run()).toEqual({ isAdmin: false, processId: "core" });
    vi.mocked(isAdmin).mockResolvedValue(true);
    expect(await run()).toEqual({ isAdmin: true, processId: "core" });
  });

  it("sends non-Core members home", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
