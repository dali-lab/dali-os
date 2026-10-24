import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { loader } from "../hiring.drive-folders";

const run = () => loader({ request: new Request("http://x/hiring/drive-folders") } as never);

describe("hiring.drive-folders loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
  });

  it("returns the Hiring process id", async () => {
    expect(await run()).toEqual({ processId: "hiring" });
  });

  it("sends non-Core members home", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
  });
});
