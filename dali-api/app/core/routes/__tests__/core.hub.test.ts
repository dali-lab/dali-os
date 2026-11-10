import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isCore: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getOpenCycles: vi.fn(),
  isCoreCycleEligible: vi.fn(),
  loadCoreTaskboard: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }) }));
vi.mock("~/lib/roles", () => ({ isCore: m.isCore, getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("~/hiring/lib/cycles", () => ({ getOpenCycles: m.getOpenCycles }));
vi.mock("~/hiring/lib/core-hiring.server", () => ({ isCoreCycleEligible: m.isCoreCycleEligible }));
vi.mock("~/core/lib/taskboard.server", () => ({ loadCoreTaskboard: m.loadCoreTaskboard }));
vi.mock("~/core/components/taskboard/CoreTaskBoard", () => ({ CoreTaskBoard: () => null }));

import { loader, shouldRevalidate } from "~/core/routes/core.hub";

const run = (url = "http://x/core") => loader({ request: new Request(url) } as never) as Promise<any>;
const location = (r: Response) => r.headers.get("Location");

beforeEach(() => {
  vi.resetAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.edu" } });
  m.getUserRoles.mockResolvedValue({ isCore: true });
  m.getOpenCycles.mockResolvedValue([]);
});

describe("core hub loader", () => {
  it("sends non-Core members home", async () => {
    m.isCore.mockResolvedValue(false);
    expect(location(await run())).toBe("/");
    expect(m.loadCoreTaskboard).not.toHaveBeenCalled();
  });

  it("sends an eligible non-Core member to the Core application when a cycle is open", async () => {
    m.isCore.mockResolvedValue(false);
    m.getOpenCycles.mockResolvedValue([{ id: "c1" }]);
    m.isCoreCycleEligible.mockResolvedValue(true);
    expect(location(await run())).toBe("/core/apply");
  });

  it("redirects Core to Staffing while the flag is off, keeping embed", async () => {
    m.isCore.mockResolvedValue(true);
    m.isFeatureEnabled.mockResolvedValue(false);
    expect(location(await run())).toBe("/core/staffing");
    expect(location(await run("http://x/core?embed=1"))).toBe("/core/staffing?embed=1");
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("core-taskboard", "u1", { isCore: true }, expect.any(Request));
  });

  it("returns the board data to Core once the flag is on", async () => {
    m.isCore.mockResolvedValue(true);
    m.isFeatureEnabled.mockResolvedValue(true);
    m.loadCoreTaskboard.mockResolvedValue({ projectId: "core1", tasks: [], options: {} });
    expect(await run()).toEqual({
      projectId: "core1",
      tasks: [],
      options: {},
      currentUserId: "u1",
      currentUserName: "Ada Lovelace",
    });
  });
});

describe("core hub shouldRevalidate", () => {
  const args = (cur: string, next: string, over: object = {}) => ({
    currentUrl: new URL(cur),
    nextUrl: new URL(next),
    defaultShouldRevalidate: true,
    ...over,
  });

  it("skips a filter or open-task change", () => {
    expect(shouldRevalidate(args("http://x/core", "http://x/core?q=a"))).toBe(false);
    expect(shouldRevalidate(args("http://x/core?q=a", "http://x/core?q=a&task=t1"))).toBe(false);
  });

  it("revalidates on an explicit revalidate and after a form post", () => {
    expect(shouldRevalidate(args("http://x/core?q=a", "http://x/core?q=a"))).toBe(true);
    expect(shouldRevalidate(args("http://x/core", "http://x/core?q=a", { formMethod: "post" }))).toBe(true);
  });
});
