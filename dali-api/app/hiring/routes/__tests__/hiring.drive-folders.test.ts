import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/bindings.server", () => ({ HIRING_PROCESS_ID: "hiring" }));
vi.mock("~/lib/drive-receivers.server", () => ({ receiversEnabled: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { receiversEnabled } from "~/lib/drive-receivers.server";
import { loader } from "../hiring.drive-folders";

const run = () => loader({ request: new Request("http://x/hiring/drive-folders") } as never);

describe("hiring.drive-folders loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
  });

  it("reports the drive-receivers flag so the page can choose receivers or bindings", async () => {
    vi.mocked(receiversEnabled).mockResolvedValue(true);
    expect(await run()).toEqual({ processId: "hiring", receiversEnabled: true });
    vi.mocked(receiversEnabled).mockResolvedValue(false);
    expect(await run()).toEqual({ processId: "hiring", receiversEnabled: false });
  });

  it("sends non-Core members home without reading the flag", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
    expect(receiversEnabled).not.toHaveBeenCalled();
  });
});
