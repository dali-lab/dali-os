import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/infra/dashboard.server", () => ({ loadFleet: vi.fn(), buildCleanup: vi.fn() }));
vi.mock("~/lib/infra/crypto.server", () => ({ infraCryptoConfigured: vi.fn() }));
vi.mock("~/lib/infra/neon.server", () => ({ neonConfigured: vi.fn() }));
vi.mock("~/lib/infra/requests.server", () => ({ listPendingInfraRequests: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadFleet, buildCleanup } from "~/lib/infra/dashboard.server";
import { resolveTermFilter } from "~/lib/terms";
import { listPendingInfraRequests } from "~/lib/infra/requests.server";
import { fleetTotals, loader, stateTone } from "~/admin/routes/admin.infrastructure";

const machine = (state: string) => ({ state }) as never;
const endpoint = (currentState: string) => ({ currentState }) as never;

describe("fleetTotals", () => {
  it("counts apps, running machines and active computes across projects", () => {
    const totals = fleetTotals([
      {
        fly: { orgSlug: "o", apps: [{ machines: [machine("started"), machine("stopped")] } as never] },
        neon: { orgId: "n", projects: [{ endpoints: [endpoint("active"), endpoint("idle")] } as never] },
      },
      { fly: { orgSlug: "o", apps: [{ machines: [machine("started")] } as never] }, neon: null },
      { fly: null, neon: null },
    ]);
    expect(totals).toEqual({ apps: 2, machines: 3, running: 2, computes: 2, activeComputes: 1 });
  });
});

describe("stateTone", () => {
  it("is ok when running, idle when parked, and warn otherwise", () => {
    expect(stateTone("started")).toBe("ok");
    expect(stateTone("active")).toBe("ok");
    for (const s of ["idle", "stopped", "suspended"]) expect(stateTone(s)).toBe("idle");
    expect(stateTone("init")).toBe("warn");
  });
});

describe("admin.infrastructure loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: true, isAdmin: false } as never);
  });

  it("sends Core back to the Admin overview while the infra-dashboard flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = (await loader({ request: new Request("http://x"), params: {}, context: {} } as never)) as Response;
    expect(res.headers.get("Location")).toBe("/admin");
  });
});

describe("admin.infrastructure loader, flag on", () => {
  const fleet = {
    projects: [{ projectId: "p1" }],
    unlinked: [{ projectId: "p0", unlinked: true }],
    knownOrgs: { fly: [], neon: [] },
    lastSweep: null,
    protectedFly: [],
    protectedNeon: [],
  };
  const load = () => loader({ request: new Request("http://x"), params: {}, context: {} } as never) as Promise<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: true, isAdmin: false } as never);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    vi.mocked(loadFleet).mockResolvedValue(fleet as never);
    vi.mocked(buildCleanup).mockReturnValue([]);
    vi.mocked(listPendingInfraRequests).mockResolvedValue([]);
  });

  it("lists every project in the selected term", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ terms: [], selected: "t26f", termId: "t26f", isAll: false } as never);
    await load();
    expect(loadFleet).toHaveBeenCalledWith({ all: true, termId: "t26f" });
  });

  it("lists every project across terms for All terms", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ terms: [], selected: "all", termId: null, isAll: true } as never);
    await load();
    expect(loadFleet).toHaveBeenCalledWith({ all: true, termId: null });
  });

  it("reviews unlinked org resources for cleanup too", async () => {
    vi.mocked(resolveTermFilter).mockResolvedValue({ terms: [], selected: "all", termId: null, isAll: true } as never);
    const data = await load();
    expect(buildCleanup).toHaveBeenCalledWith([...fleet.projects, ...fleet.unlinked]);
    expect(data.unlinked).toEqual(fleet.unlinked);
    expect(data.knownOrgs).toEqual(fleet.knownOrgs);
  });
});
