import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, listCreds, neonMock } = vi.hoisted(() => ({
  prismaMock: {
    infraSnapshot: { create: vi.fn(), deleteMany: vi.fn() },
    infraUsageSample: { upsert: vi.fn() },
  },
  listCreds: vi.fn(),
  neonMock: { getNeonInventory: vi.fn(), getConsumption: vi.fn(), neonConfigured: vi.fn() },
}));

vi.mock("~/lib/db", () => ({ prisma: prismaMock }));
vi.mock("~/lib/infra/project-infra.server", () => ({ listEnabledInfraProjectCreds: listCreds }));
vi.mock("~/lib/infra/fly.server", () => ({ getFlyInventory: vi.fn(), getFlyEgressByApp: vi.fn() }));
vi.mock("~/lib/infra/neon.server", () => neonMock);

import { runInfraSnapshot } from "../infra-snapshot.server";

const ctx = { now: new Date("2026-10-25T12:00:00Z"), lastSuccessAt: null, settings: {} };

const creds = (projectId: string, neonProjectIds: string[], neonOrgId = "org-dali-1") => ({
  projectId,
  name: projectId,
  flyOrgSlug: null,
  neonOrgId,
  neonProjectIds,
  flyReadToken: null,
  flyWriteToken: null,
  infraEnabled: true,
});

const inventory = (orgId: string) => ({
  orgId,
  projects: [
    { id: "np-a", name: "Alpha" },
    { id: "np-b", name: "Beta" },
  ],
});

const usage = (projectId: string) => ({
  projectId,
  metric: "compute_unit_seconds",
  value: 3600,
  periodStart: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.infraSnapshot.create.mockImplementation(async () => ({ id: "snap" }));
  neonMock.neonConfigured.mockReturnValue(true);
  neonMock.getNeonInventory.mockImplementation(async (orgId: string) => inventory(orgId));
  neonMock.getConsumption.mockResolvedValue([usage("np-a"), usage("np-b")]);
});

describe("runInfraSnapshot Neon", () => {
  it("fetches a shared org once per run", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p2", ["np-b"])]);
    await runInfraSnapshot(ctx);
    expect(neonMock.getNeonInventory).toHaveBeenCalledTimes(1);
    expect(neonMock.getConsumption).toHaveBeenCalledTimes(1);
  });

  it("fetches each distinct org", async () => {
    listCreds.mockResolvedValue([creds("p1", [], "org-1"), creds("p2", [], "org-2")]);
    await runInfraSnapshot(ctx);
    expect(neonMock.getNeonInventory.mock.calls.map((c) => c[0])).toEqual(["org-1", "org-2"]);
  });

  it("stores the whole org inventory on each project's snapshot", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p2", [])]);
    await runInfraSnapshot(ctx);
    const payloads = prismaMock.infraSnapshot.create.mock.calls.map((c) => c[0].data);
    expect(payloads).toEqual([
      { projectId: "p1", provider: "neon", payload: inventory("org-dali-1") },
      { projectId: "p2", provider: "neon", payload: inventory("org-dali-1") },
    ]);
  });

  it("writes usage only for each project's linked databases", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-a"]), creds("p2", ["np-b"]), creds("p3", [])]);
    await runInfraSnapshot(ctx);
    const rows = prismaMock.infraUsageSample.upsert.mock.calls.map((c) => [c[0].create.projectId, c[0].create.scopeId]);
    expect(rows).toEqual([
      ["p1", "np-a"],
      ["p2", "np-b"],
    ]);
  });

  it("moves an existing usage row to the project now linked to it", async () => {
    listCreds.mockResolvedValue([creds("p2", ["np-a"])]);
    await runInfraSnapshot(ctx);
    expect(prismaMock.infraUsageSample.upsert.mock.calls[0][0].update).toMatchObject({ projectId: "p2", value: 3600 });
  });

  it("names usage rows from the org inventory", async () => {
    listCreds.mockResolvedValue([creds("p1", ["np-b"])]);
    await runInfraSnapshot(ctx);
    expect(prismaMock.infraUsageSample.upsert.mock.calls[0][0].create.scopeName).toBe("Beta");
  });
});
