import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, listCreds, getCreds, neonMock, flyMock } = vi.hoisted(() => ({
  prismaMock: {
    infraSnapshot: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    infraUsageSample: { upsert: vi.fn() },
  },
  listCreds: vi.fn(),
  getCreds: vi.fn(),
  neonMock: { getNeonInventory: vi.fn(), getConsumption: vi.fn(), neonConfigured: vi.fn() },
  flyMock: { getFlyInventory: vi.fn(), getFlyEgressByApp: vi.fn(), getFlyMachineHoursByApp: vi.fn(), getFlyDayByApp: vi.fn() },
}));

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/infra/project-infra.server", () => ({
  listEnabledInfraProjectCreds: listCreds,
  getProjectInfraCreds: getCreds,
}));
vi.mock("~/lib/infra/fly.server", () => flyMock);
vi.mock("~/lib/infra/neon.server", () => neonMock);

import { adoptOrgSnapshot, flyDailyDays, refreshProjectInfra, runInfraSnapshot } from "../infra-snapshot.server";

const now = new Date("2026-10-25T12:00:00Z");
const ctx = { now, lastSuccessAt: new Date("2026-10-25T11:00:00Z"), settings: {} };

const creds = (projectId: string, neonProjectIds: string[], neonOrgId: string | null = "org-dali-1") => ({
  projectId,
  name: projectId,
  flyOrgSlug: null as string | null,
  flyAppNames: [] as string[],
  neonOrgId,
  neonProjectIds,
  flyReadToken: null as string | null,
  flyWriteToken: null,
  infraEnabled: true,
});

const inventory = (orgId: string) => ({
  orgId,
  plan: "launch",
  projects: [
    { id: "np-a", name: "Alpha", branches: [{ id: "br-main", name: "main" }, { id: "br-pr", name: "preview-pr-7" }] },
    { id: "np-b", name: "Beta", branches: [] },
  ],
});

type Opts = { scope: string; granularity: string; from: string; projectIds?: string[] };
const sample = (projectId: string, at: string, branchId: string | null = null) => ({
  projectId,
  branchId,
  metric: "compute_unit_seconds",
  value: 3600,
  at,
  plan: "launch",
});

function consumption(opts: Opts) {
  if (opts.scope === "branches") return [sample("np-a", "2026-10-01T00:00:00Z", "br-pr")];
  if (opts.granularity === "monthly") return [sample("np-a", "2026-10-01T00:00:00Z"), sample("np-b", "2026-10-01T00:00:00Z")];
  return [sample("np-a", "2026-10-24T00:00:00Z"), sample("np-b", "2026-10-24T00:00:00Z")];
}

const upserts = () => prismaMock.infraUsageSample.upsert.mock.calls.map((c) => c[0]);
const calls = (): Opts[] => neonMock.getConsumption.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.infraSnapshot.create.mockImplementation(async () => ({ id: "snap" }));
  neonMock.neonConfigured.mockReturnValue(true);
  neonMock.getNeonInventory.mockImplementation(async (orgId: string) => inventory(orgId));
  neonMock.getConsumption.mockImplementation(async (opts: Opts) => consumption(opts));
});

describe("runInfraSnapshot Neon", () => {
  it("reads each shared org once per run: daily, monthly, and branch usage", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p2", ["np-b"])]);
    await runInfraSnapshot(ctx);
    expect(neonMock.getNeonInventory).toHaveBeenCalledTimes(1);
    expect(calls().map((c) => `${c.scope}/${c.granularity}`)).toEqual([
      "projects/daily",
      "projects/monthly",
      "branches/monthly",
    ]);
  });

  it("fetches each distinct org", async () => {
    listCreds.mockResolvedValue([creds("p1", [], "org-1"), creds("p2", [], "org-2")]);
    await runInfraSnapshot(ctx);
    expect(neonMock.getNeonInventory.mock.calls.map((c) => c[0])).toEqual(["org-1", "org-2"]);
  });

  it("stores the whole org inventory on each project's snapshot", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p2", [])]);
    await runInfraSnapshot(ctx);
    expect(prismaMock.infraSnapshot.create.mock.calls.map((c) => c[0].data)).toEqual([
      { projectId: "p1", provider: "neon", payload: inventory("org-dali-1") },
      { projectId: "p2", provider: "neon", payload: inventory("org-dali-1") },
    ]);
  });

  it("writes daily, monthly, and branch rows for linked databases only", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p3", [])]);
    await runInfraSnapshot(ctx);
    expect(upserts().map((u) => [u.create.projectId, u.create.scopeType, u.create.scopeId, u.create.at.toISOString()])).toEqual([
      ["p1", "neon-project", "np-a", "2026-10-24T00:00:00.000Z"],
      ["p1", "neon-project-month", "np-a", "2026-10-01T00:00:00.000Z"],
      ["p1", "neon-branch-month", "np-a:br-pr", "2026-10-01T00:00:00.000Z"],
    ]);
  });

  it("names branch rows after the database and branch", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    await runInfraSnapshot(ctx);
    expect(upserts().find((u) => u.create.scopeType === "neon-branch-month").create.scopeName).toBe("Alpha / preview-pr-7");
  });

  it("moves an existing usage row to the project now linked to it", async () => {
    listCreds.mockResolvedValue([creds("p2", ["np-a"])]);
    await runInfraSnapshot(ctx);
    expect(upserts()[0].update).toMatchObject({ projectId: "p2", value: 3600 });
  });

  it("reads branch usage for the org's databases from the start of this month", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    await runInfraSnapshot(ctx);
    const branches = calls().find((c) => c.scope === "branches")!;
    expect(branches.projectIds).toEqual(["np-a", "np-b"]);
    expect(branches.from).toBe("2026-10-01T00:00:00.000Z");
  });

  it("re-reads only the last two days on later runs the same day", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    await runInfraSnapshot(ctx);
    expect(calls().find((c) => c.granularity === "daily")!.from).toBe("2026-10-24T00:00:00.000Z");
  });

  it("re-reads from last month's start on the first run of a day", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    await runInfraSnapshot({ ...ctx, lastSuccessAt: new Date("2026-10-24T23:00:00Z") });
    expect(calls().find((c) => c.granularity === "daily")!.from).toBe("2026-09-01T00:00:00.000Z");
  });

  it("caps the daily window at Neon's 60 days", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    await runInfraSnapshot({ now: new Date("2027-01-31T12:00:00Z"), lastSuccessAt: null, settings: {} });
    expect(calls().find((c) => c.granularity === "daily")!.from).toBe("2026-12-03T00:00:00.000Z");
  });

  it("keeps the other series when one consumption read fails", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    neonMock.getConsumption.mockImplementation(async (opts: Opts) => {
      if (opts.granularity === "daily") throw new Error("429");
      return consumption(opts);
    });
    await runInfraSnapshot(ctx);
    expect(upserts().map((u) => u.create.scopeType)).toEqual(["neon-project-month", "neon-branch-month"]);
  });

  it("logs which consumption read failed and why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    listCreds.mockResolvedValue([creds("p1", ["np-a"])]);
    neonMock.getConsumption.mockImplementation(async (opts: Opts) => {
      if (opts.scope === "branches") throw new Error("Neon API 400 on /consumption_history/v2/branches");
      return consumption(opts);
    });
    await runInfraSnapshot(ctx);
    expect(error).toHaveBeenCalledWith(
      "infra-snapshot neon branches read failed",
      "org-dali-1",
      "Neon API 400 on /consumption_history/v2/branches",
    );
    error.mockRestore();
  });
});

describe("runInfraSnapshot Fly", () => {
  const flyCreds = (projectId: string, flyAppNames: string[]) => ({
    ...creds(projectId, [], null),
    flyOrgSlug: "dali-os",
    flyReadToken: "tok",
    flyAppNames,
  });

  beforeEach(() => {
    flyMock.getFlyInventory.mockResolvedValue({ orgSlug: "dali-os", apps: [] });
    flyMock.getFlyEgressByApp.mockResolvedValue([
      { appName: "web", egressBytes: 10 },
      { appName: "ultrasound", egressBytes: 20 },
    ]);
    flyMock.getFlyMachineHoursByApp.mockResolvedValue([{ appName: "web", machineHours: 48 }]);
    flyMock.getFlyDayByApp.mockResolvedValue([]);
  });

  it("reads a shared org once per run", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"]), flyCreds("p2", ["ultrasound"])]);
    await runInfraSnapshot(ctx);
    expect(flyMock.getFlyInventory).toHaveBeenCalledTimes(1);
    expect(flyMock.getFlyEgressByApp).toHaveBeenCalledTimes(1);
    expect(flyMock.getFlyMachineHoursByApp).toHaveBeenCalledTimes(1);
  });

  it("stores the whole org on each project's snapshot", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"]), flyCreds("p2", [])]);
    await runInfraSnapshot(ctx);
    expect(prismaMock.infraSnapshot.create.mock.calls.map((c) => c[0].data.projectId)).toEqual(["p1", "p2"]);
  });

  it("writes usage only for each project's linked apps", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"]), flyCreds("p2", ["ultrasound"]), flyCreds("p3", [])]);
    await runInfraSnapshot(ctx);
    expect(upserts().map((u) => [u.create.projectId, u.create.scopeId, u.create.metric])).toEqual([
      ["p1", "web", "egress_bytes"],
      ["p1", "web", "machine_hours_24h"],
      ["p2", "ultrasound", "egress_bytes"],
    ]);
  });

  it("records machine hours per app at the sweep time", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"])]);
    await runInfraSnapshot(ctx);
    expect(upserts().find((u) => u.create.metric === "machine_hours_24h").create).toMatchObject({
      provider: "fly",
      scopeType: "fly-app",
      value: 48,
      at: now,
    });
  });

  it("still records egress when machine hours fail", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"])]);
    flyMock.getFlyMachineHoursByApp.mockRejectedValue(new Error("403"));
    await runInfraSnapshot(ctx);
    expect(upserts().map((u) => u.create.metric)).toEqual(["egress_bytes"]);
  });

  it("logs a failed Prometheus read with its status", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    listCreds.mockResolvedValue([flyCreds("p1", ["web"])]);
    flyMock.getFlyEgressByApp.mockRejectedValue(new Error("Fly Prometheus 401"));
    await runInfraSnapshot(ctx);
    expect(error).toHaveBeenCalledWith("infra-snapshot fly egress read failed", "dali-os", "Fly Prometheus 401");
    error.mockRestore();
  });

  it("stores one row per app, metric and day for linked apps", async () => {
    listCreds.mockResolvedValue([flyCreds("p1", ["web"])]);
    flyMock.getFlyDayByApp.mockImplementation(async (_t: string, _o: string, day: Date) => [
      { appName: "web", metric: "requests", value: day.getUTCDate() },
      { appName: "ultrasound", metric: "requests", value: 1 },
    ]);
    await runInfraSnapshot(ctx);
    const daily = upserts().filter((u) => u.create.scopeType === "fly-app-day").map((u) => u.create);
    expect(daily).toEqual([
      expect.objectContaining({ scopeId: "web", metric: "requests", value: 24, at: new Date("2026-10-24T00:00:00Z") }),
      expect.objectContaining({ scopeId: "web", metric: "requests", value: 25, at: new Date("2026-10-25T00:00:00Z") }),
    ]);
  });

  it("logs a failed day and keeps the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    listCreds.mockResolvedValue([flyCreds("p1", ["web"])]);
    flyMock.getFlyDayByApp
      .mockRejectedValueOnce(new Error("Fly Prometheus 429"))
      .mockResolvedValueOnce([{ appName: "web", metric: "requests", value: 5 }]);
    await runInfraSnapshot(ctx);
    expect(error).toHaveBeenCalledWith("infra-snapshot fly daily read failed", "dali-os", "Fly Prometheus 429");
    expect(upserts().filter((u) => u.create.scopeType === "fly-app-day")).toHaveLength(1);
    error.mockRestore();
  });

  it("skips a project without a read token", async () => {
    listCreds.mockResolvedValue([{ ...flyCreds("p1", ["web"]), flyReadToken: null }]);
    await runInfraSnapshot(ctx);
    expect(flyMock.getFlyInventory).not.toHaveBeenCalled();
  });
});

describe("adoptOrgSnapshot", () => {
  const snap = (projectId: string, orgId: string, tag = orgId) => ({ projectId, payload: { orgId, tag } });

  it("copies the newest other project's sweep of the same org", async () => {
    prismaMock.infraSnapshot.findMany.mockResolvedValue([snap("p2", "org-dali-1", "newest"), snap("p3", "org-dali-1", "older")]);
    expect(await adoptOrgSnapshot("p1", "neon", "org-dali-1")).toBe(true);
    expect(prismaMock.infraSnapshot.create.mock.calls[0][0].data).toEqual({
      projectId: "p1",
      provider: "neon",
      payload: { orgId: "org-dali-1", tag: "newest" },
    });
  });

  it("keeps the project's own sweep when it is already for that org", async () => {
    prismaMock.infraSnapshot.findMany.mockResolvedValue([snap("p2", "org-dali-1"), snap("p1", "org-dali-1")]);
    expect(await adoptOrgSnapshot("p1", "neon", "org-dali-1")).toBe(false);
    expect(prismaMock.infraSnapshot.create).not.toHaveBeenCalled();
  });

  it("replaces the project's sweep of a different org", async () => {
    prismaMock.infraSnapshot.findMany.mockResolvedValue([snap("p1", "org-old"), snap("p2", "org-dali-1")]);
    expect(await adoptOrgSnapshot("p1", "neon", "org-dali-1")).toBe(true);
  });

  it("does nothing for an org nobody has swept", async () => {
    prismaMock.infraSnapshot.findMany.mockResolvedValue([snap("p2", "org-other")]);
    expect(await adoptOrgSnapshot("p1", "neon", "org-new")).toBe(false);
    expect(prismaMock.infraSnapshot.create).not.toHaveBeenCalled();
  });
});

describe("refreshProjectInfra", () => {
  it("adopts the org's sweep, then sweeps the project with a full daily window", async () => {
    getCreds.mockResolvedValue(creds("p1", ["np-a"]));
    prismaMock.infraSnapshot.findMany.mockResolvedValue([
      { projectId: "p2", payload: inventory("org-dali-1") },
    ]);
    await refreshProjectInfra("p1");
    expect(prismaMock.infraSnapshot.create.mock.calls[0][0].data.projectId).toBe("p1");
    await vi.waitFor(() => expect(neonMock.getNeonInventory).toHaveBeenCalledWith("org-dali-1"));
    await vi.waitFor(() => expect(calls().some((c) => c.granularity === "daily")).toBe(true));
    const daily = calls().find((c) => c.granularity === "daily")!;
    expect(new Date(daily.from).getUTCDate()).toBe(1);
  });

  it("does nothing when the sweep is off", async () => {
    getCreds.mockResolvedValue({ ...creds("p1", ["np-a"]), infraEnabled: false });
    await refreshProjectInfra("p1");
    expect(prismaMock.infraSnapshot.findMany).not.toHaveBeenCalled();
    expect(neonMock.getNeonInventory).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown project", async () => {
    getCreds.mockResolvedValue(null);
    await refreshProjectInfra("p404");
    expect(neonMock.getNeonInventory).not.toHaveBeenCalled();
  });

  it("does not throw when the background sweep fails", async () => {
    getCreds.mockResolvedValue(creds("p1", ["np-a"]));
    prismaMock.infraSnapshot.findMany.mockResolvedValue([]);
    neonMock.getNeonInventory.mockRejectedValue(new Error("Neon down"));
    await expect(refreshProjectInfra("p1")).resolves.toBeUndefined();
  });
});

describe("adoptOrgSnapshot Fly", () => {
  it("copies another project's sweep of the same Fly org", async () => {
    prismaMock.infraSnapshot.findMany.mockResolvedValue([
      { projectId: "p2", payload: { orgSlug: "other", apps: [] } },
      { projectId: "p3", payload: { orgSlug: "dali-os", apps: [{ name: "web" }] } },
    ]);
    expect(await adoptOrgSnapshot("p1", "fly", "dali-os")).toBe(true);
    expect(prismaMock.infraSnapshot.create.mock.calls[0][0].data).toEqual({
      projectId: "p1",
      provider: "fly",
      payload: { orgSlug: "dali-os", apps: [{ name: "web" }] },
    });
    expect(prismaMock.infraSnapshot.findMany.mock.calls[0][0].where).toEqual({ provider: "fly" });
  });
});

describe("refreshProjectInfra Fly", () => {
  it("adopts the Fly org's sweep too", async () => {
    getCreds.mockResolvedValue({ ...creds("p1", [], null), flyOrgSlug: "dali-os", flyReadToken: "tok", flyAppNames: ["web"] });
    prismaMock.infraSnapshot.findMany.mockResolvedValue([{ projectId: "p2", payload: { orgSlug: "dali-os", apps: [] } }]);
    flyMock.getFlyInventory.mockResolvedValue({ orgSlug: "dali-os", apps: [] });
    flyMock.getFlyEgressByApp.mockResolvedValue([]);
    flyMock.getFlyMachineHoursByApp.mockResolvedValue([]);
    await refreshProjectInfra("p1");
    expect(prismaMock.infraSnapshot.create.mock.calls[0][0].data).toMatchObject({ projectId: "p1", provider: "fly" });
    await vi.waitFor(() => expect(flyMock.getFlyInventory).toHaveBeenCalledWith("tok", "dali-os"));
  });
});

describe("flyDailyDays", () => {
  const days = (c: { now: Date; lastSuccessAt: Date | null }) =>
    flyDailyDays({ ...c, settings: {} }).map((d) => d.toISOString().slice(0, 10));

  it("reads the 12 days Fly keeps on the first run of a UTC day", () => {
    const out = days({ now, lastSuccessAt: new Date("2026-10-24T23:00:00Z") });
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("2026-10-14");
    expect(out[11]).toBe("2026-10-25");
  });

  it("reads them all on the very first run", () => {
    expect(days({ now, lastSuccessAt: null })).toHaveLength(12);
  });

  it("reads yesterday and today on later runs that day", () => {
    expect(days({ now, lastSuccessAt: new Date("2026-10-25T11:00:00Z") })).toEqual(["2026-10-24", "2026-10-25"]);
  });
});
