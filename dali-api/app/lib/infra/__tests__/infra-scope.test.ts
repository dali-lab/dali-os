import { describe, expect, it } from "vitest";
import {
  branchScopeId,
  branchUsage,
  isSampleInScope,
  keepLinkedInOrg,
  neonCostSummary,
  neonDailyUsage,
  flyDailyUsage,
  flyDayTotals,
  orgResourceOptions,
  flyAppOptions,
  knownOrgs,
  scopeFlyInventory,
  unlinkedResources,
  neonProjectOptions,
  projectUsage,
  SCOPE,
  scopeNeonInventory,
  usageSeries,
  type ScopedSample,
} from "../infra-scope";
import type { NeonInventory, NeonProject } from "../types";

function project(id: string, name = id): NeonProject {
  return {
    id,
    name,
    regionId: "aws-us-east-2",
    pgVersion: 17,
    createdAt: null,
    quota: {
      activeTimeSeconds: null,
      computeTimeSeconds: null,
      writtenDataBytes: null,
      dataTransferBytes: null,
      logicalSizeBytes: null,
    },
    branches: [],
    endpoints: [],
  };
}

const org: NeonInventory = {
  orgId: "org-dali-1",
  projects: [project("np-a", "Alpha"), project("np-b", "Beta"), project("np-c", "Gamma")],
};

function sample(over: Partial<ScopedSample>): ScopedSample {
  return {
    provider: "neon",
    scopeType: "neon-project",
    scopeId: "np-a",
    metric: "compute_unit_seconds",
    value: 1,
    at: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

describe("scopeNeonInventory", () => {
  it("keeps only the linked Neon projects", () => {
    expect(scopeNeonInventory(org, ["np-c", "np-a"])?.projects.map((p) => p.id)).toEqual(["np-a", "np-c"]);
  });

  it("keeps none when nothing is linked", () => {
    expect(scopeNeonInventory(org, [])).toEqual({ orgId: "org-dali-1", projects: [] });
  });

  it("ignores linked ids the org no longer has", () => {
    expect(scopeNeonInventory(org, ["np-gone"])?.projects).toEqual([]);
  });

  it("passes a missing snapshot through as null", () => {
    expect(scopeNeonInventory(null, ["np-a"])).toBeNull();
  });

  it("does not mutate the cached org inventory", () => {
    scopeNeonInventory(org, ["np-a"]);
    expect(org.projects).toHaveLength(3);
  });
});

describe("neonProjectOptions", () => {
  it("lists every database in the org by id and name", () => {
    expect(neonProjectOptions(org)).toEqual([
      { id: "np-a", name: "Alpha" },
      { id: "np-b", name: "Beta" },
      { id: "np-c", name: "Gamma" },
    ]);
  });

  it("is empty before the first sweep", () => {
    expect(neonProjectOptions(null)).toEqual([]);
  });
});

describe("isSampleInScope", () => {
  it("keeps Neon samples for linked databases only", () => {
    expect(isSampleInScope(sample({ scopeId: "np-a" }), { neonProjectIds: ["np-a"], flyAppNames: [] })).toBe(true);
    expect(isSampleInScope(sample({ scopeId: "np-b" }), { neonProjectIds: ["np-a"], flyAppNames: [] })).toBe(false);
    expect(isSampleInScope(sample({ scopeId: "np-a" }), { neonProjectIds: [], flyAppNames: [] })).toBe(false);
  });

  it("drops Fly samples when no app is linked", () => {
    const fly = sample({ provider: "fly", scopeType: "fly-app", scopeId: "web", metric: "egress_bytes" });
    expect(isSampleInScope(fly, { neonProjectIds: [], flyAppNames: [] })).toBe(false);
  });
});

describe("usageSeries", () => {
  it("sums samples that share a metric and time", () => {
    const series = usageSeries([
      sample({ scopeId: "np-a", value: 3600 }),
      sample({ scopeId: "np-c", value: 1800 }),
    ]);
    expect(series).toEqual([
      { metric: "compute_unit_seconds", points: [{ at: "2026-10-01T00:00:00.000Z", value: 5400 }], current: 5400 },
    ]);
  });

  it("orders points by time regardless of input order", () => {
    const series = usageSeries([
      sample({ at: new Date("2026-10-01T00:00:00Z"), value: 2 }),
      sample({ at: new Date("2026-09-01T00:00:00Z"), value: 1 }),
    ]);
    expect(series[0].points.map((p) => p.value)).toEqual([1, 2]);
  });

  it("keeps one series per metric", () => {
    const series = usageSeries([
      sample({ metric: "compute_unit_seconds" }),
      sample({ metric: "public_network_transfer_bytes" }),
    ]);
    expect(series.map((s) => s.metric)).toEqual(["compute_unit_seconds", "public_network_transfer_bytes"]);
  });

  it("keeps only the most recent points", () => {
    const samples = Array.from({ length: 5 }, (_, i) =>
      sample({ at: new Date(Date.UTC(2026, i, 1)), value: i }),
    );
    expect(usageSeries(samples, 2)[0].points.map((p) => p.value)).toEqual([3, 4]);
  });

  it("is empty with no samples", () => {
    expect(usageSeries([])).toEqual([]);
  });
});

describe("isSampleInScope for branch rows", () => {
  it("scopes branch rows by their database", () => {
    const branch = sample({ scopeType: SCOPE.neonBranchMonth, scopeId: branchScopeId("np-a", "br-1") });
    expect(isSampleInScope(branch, { neonProjectIds: ["np-a"], flyAppNames: [] })).toBe(true);
    expect(isSampleInScope(branch, { neonProjectIds: ["np-b"], flyAppNames: [] })).toBe(false);
  });
});

const NOW = new Date("2026-10-25T12:00:00Z");
const OCT = new Date("2026-10-01T00:00:00Z");
const SEP = new Date("2026-09-01T00:00:00Z");

describe("projectUsage", () => {
  it("draws daily points but heads each Neon metric with month to date", () => {
    const usage = projectUsage(
      [
        sample({ scopeType: SCOPE.neonDaily, at: new Date("2026-10-24T00:00:00Z"), value: 10 }),
        sample({ scopeType: SCOPE.neonDaily, at: new Date("2026-10-25T00:00:00Z"), value: 20 }),
        sample({ scopeType: SCOPE.neonMonth, at: OCT, value: 500 }),
      ],
      NOW,
    );
    expect(usage).toEqual([
      {
        metric: "compute_unit_seconds",
        points: [
          { at: "2026-10-24T00:00:00.000Z", value: 10 },
          { at: "2026-10-25T00:00:00.000Z", value: 20 },
        ],
        current: 500,
      },
    ]);
  });

  it("sums month to date across databases", () => {
    const usage = projectUsage(
      [
        sample({ scopeType: SCOPE.neonDaily, value: 1 }),
        sample({ scopeType: SCOPE.neonMonth, scopeId: "np-a", at: OCT, value: 100 }),
        sample({ scopeType: SCOPE.neonMonth, scopeId: "np-c", at: OCT, value: 50 }),
      ],
      NOW,
    );
    expect(usage[0].current).toBe(150);
  });

  it("adds up this month's daily rows when the monthly row is missing", () => {
    const usage = projectUsage(
      [
        sample({ scopeType: SCOPE.neonDaily, at: new Date("2026-09-30T00:00:00Z"), value: 1000 }),
        sample({ scopeType: SCOPE.neonDaily, at: new Date("2026-10-01T00:00:00Z"), value: 10 }),
        sample({ scopeType: SCOPE.neonDaily, at: new Date("2026-10-24T00:00:00Z"), value: 20 }),
      ],
      NOW,
    );
    expect(usage[0].current).toBe(30);
  });

  it("ignores last month's total for the headline", () => {
    const usage = projectUsage(
      [sample({ scopeType: SCOPE.neonDaily, value: 1 }), sample({ scopeType: SCOPE.neonMonth, at: SEP, value: 999 })],
      NOW,
    );
    expect(usage[0].current).toBe(1);
  });

  it("heads Fly metrics with the latest reading", () => {
    const fly = (at: string, value: number) =>
      sample({ provider: "fly", scopeType: SCOPE.flyApp, scopeId: "web", metric: "machine_hours_24h", at: new Date(at), value });
    const usage = projectUsage([fly("2026-10-25T10:00:00Z", 24), fly("2026-10-25T11:00:00Z", 23)], NOW);
    expect(usage[0].current).toBe(23);
  });

  it("drops metrics that are zero throughout", () => {
    const usage = projectUsage(
      [
        sample({ scopeType: SCOPE.neonDaily, metric: "snapshot_storage_bytes_month", value: 0 }),
        sample({ scopeType: SCOPE.neonMonth, metric: "snapshot_storage_bytes_month", at: OCT, value: 0 }),
        sample({ scopeType: SCOPE.neonDaily, metric: "compute_unit_seconds", value: 5 }),
      ],
      NOW,
    );
    expect(usage.map((u) => u.metric)).toEqual(["compute_unit_seconds"]);
  });

  it("leaves branch rows out of the strip", () => {
    expect(projectUsage([sample({ scopeType: SCOPE.neonBranchMonth, scopeId: "np-a:br", at: OCT, value: 5 })], NOW)).toEqual([]);
  });
});

describe("branchUsage", () => {
  const inv: NeonInventory = {
    orgId: "org-dali-1",
    projects: [
      {
        ...project("np-a", "Alpha"),
        branches: [
          { id: "br-main", name: "main", parentId: null, createdAt: null, default: true },
          { id: "br-pr", name: "preview-pr-42", parentId: "br-main", createdAt: null, default: false },
        ],
      },
    ],
  };
  const branch = (branchId: string, metric: string, value: number, at = OCT) =>
    sample({ scopeType: SCOPE.neonBranchMonth, scopeId: branchScopeId("np-a", branchId), metric, value, at });

  it("totals compute and storage per branch, heaviest compute first", () => {
    const rows = branchUsage(
      [
        branch("br-main", "compute_unit_seconds", 100),
        branch("br-pr", "compute_unit_seconds", 900),
        branch("br-pr", "root_branch_bytes_month", 10),
        branch("br-pr", "child_branch_bytes_month", 5),
      ],
      inv,
      NOW,
    );
    expect(rows).toEqual({
      "np-a": [
        { branchId: "br-pr", name: "preview-pr-42", computeSeconds: 900, storageByteMonths: 15, preview: true },
        { branchId: "br-main", name: "main", computeSeconds: 100, storageByteMonths: 0, preview: false },
      ],
    });
  });

  it("falls back to the branch id for a branch no longer in the inventory", () => {
    const rows = branchUsage([branch("br-gone", "compute_unit_seconds", 1)], inv, NOW);
    expect(rows["np-a"][0]).toMatchObject({ name: "br-gone", preview: false });
  });

  it("only counts this month", () => {
    expect(branchUsage([branch("br-pr", "compute_unit_seconds", 1, SEP)], inv, NOW)).toEqual({});
  });
});

describe("neonCostSummary", () => {
  const month = (scopeId: string, metric: string, value: number, at = OCT) =>
    sample({ scopeType: SCOPE.neonMonth, scopeId, metric, value, at });

  it("estimates this month per database and in total", () => {
    const cost = neonCostSummary(
      [month("np-a", "compute_unit_seconds", 10 * 3600), month("np-c", "compute_unit_seconds", 20 * 3600)],
      "launch",
      NOW,
    )!;
    expect(cost.plan).toBe("launch");
    expect(cost.thisMonth).toBeCloseTo(3.18);
    expect(cost.byProject["np-a"]).toBeCloseTo(1.06);
    expect(cost.byProject["np-c"]).toBeCloseTo(2.12);
  });

  it("estimates last month separately", () => {
    const cost = neonCostSummary([month("np-a", "compute_unit_seconds", 100 * 3600, SEP)], "launch", NOW)!;
    expect(cost.thisMonth).toBe(0);
    expect(cost.lastMonth).toBeCloseTo(10.6);
  });

  it("has no last month when nothing was recorded for it", () => {
    expect(neonCostSummary([month("np-a", "compute_unit_seconds", 3600)], "launch", NOW)!.lastMonth).toBeNull();
  });

  const day = (scopeId: string, iso: string, value: number) =>
    sample({ scopeType: SCOPE.neonDaily, scopeId, at: new Date(iso), value });

  it("prefers a database's monthly rows over its daily rows so usage isn't counted twice", () => {
    const cost = neonCostSummary(
      [month("np-a", "compute_unit_seconds", 10 * 3600), day("np-a", "2026-10-24T00:00:00Z", 1e9)],
      "launch",
      NOW,
    )!;
    expect(cost.thisMonth).toBeCloseTo(1.06);
  });

  it("estimates from the daily rows for a database with no monthly rows", () => {
    const cost = neonCostSummary(
      [
        month("np-a", "compute_unit_seconds", 10 * 3600),
        day("np-c", "2026-10-01T00:00:00Z", 5 * 3600),
        day("np-c", "2026-10-24T00:00:00Z", 15 * 3600),
      ],
      "launch",
      NOW,
    )!;
    expect(cost.byProject["np-a"]).toBeCloseTo(1.06);
    expect(cost.byProject["np-c"]).toBeCloseTo(2.12);
    expect(cost.thisMonth).toBeCloseTo(3.18);
  });

  it("estimates last month from its daily rows when it has no monthly rows", () => {
    const cost = neonCostSummary(
      [day("np-a", "2026-09-01T00:00:00Z", 40 * 3600), day("np-a", "2026-09-30T00:00:00Z", 60 * 3600)],
      "launch",
      NOW,
    )!;
    expect(cost.thisMonth).toBe(0);
    expect(cost.lastMonth).toBeCloseTo(10.6);
  });

  it("ignores branch rows so usage isn't counted twice", () => {
    const cost = neonCostSummary(
      [sample({ scopeType: SCOPE.neonBranchMonth, scopeId: "np-a:br", at: OCT, value: 1e9 })],
      "launch",
      NOW,
    )!;
    expect(cost.thisMonth).toBe(0);
  });

  it("ignores months older than last month", () => {
    const cost = neonCostSummary(
      [
        month("np-a", "compute_unit_seconds", 1e9, new Date("2026-08-01T00:00:00Z")),
        day("np-a", "2026-08-31T00:00:00Z", 1e9),
      ],
      "launch",
      NOW,
    )!;
    expect(cost.lastMonth).toBeNull();
  });

  it("is null without a plan or with unknown rates", () => {
    expect(neonCostSummary([], null, NOW)).toBeNull();
    expect(neonCostSummary([], "enterprise", NOW)).toBeNull();
  });
});

describe("neonDatabaseOptions", () => {
  const known = [
    { orgId: "org-dali-1", resources: [{ id: "np-a", name: "Alpha" }, { id: "np-b", name: "Beta" }] },
    { orgId: "org-other-2", resources: [{ id: "np-z", name: "Zeta" }] },
  ];

  it("lists the chosen org's databases", () => {
    expect(orgResourceOptions("org-dali-1", known, [])).toEqual([
      { value: "np-a", label: "Alpha" },
      { value: "np-b", label: "Beta" },
    ]);
  });

  it("keeps a linked id the sweep no longer returns so it can be removed", () => {
    expect(orgResourceOptions("org-other-2", known, ["np-gone"])).toEqual([
      { value: "np-z", label: "Zeta" },
      { value: "np-gone", label: "np-gone" },
    ]);
  });

  it("is empty for an org nobody has swept", () => {
    expect(orgResourceOptions("org-new-3", known, [])).toEqual([]);
  });
});

describe("keepLinkedInOrg", () => {
  const known = [{ orgId: "org-dali-1", resources: [{ id: "np-a", name: "Alpha" }] }];

  it("keeps linked databases that belong to the new org", () => {
    expect(keepLinkedInOrg("org-dali-1", known, ["np-a", "np-x"])).toEqual(["np-a"]);
  });

  it("drops everything for an unknown org", () => {
    expect(keepLinkedInOrg("org-new-3", known, ["np-a"])).toEqual([]);
  });
});

describe("Fly scoping", () => {
  const app = (name: string) => ({ id: name, name, status: "deployed", machineCount: 0, machines: [], volumes: [] });
  const flyOrg = { orgSlug: "dali-os", apps: [app("dali-api-prod"), app("ultrasound"), app("dali-kiosk")] };

  it("keeps only the linked apps", () => {
    expect(scopeFlyInventory(flyOrg, ["ultrasound"])?.apps.map((a) => a.name)).toEqual(["ultrasound"]);
  });

  it("keeps none when nothing is linked", () => {
    expect(scopeFlyInventory(flyOrg, [])?.apps).toEqual([]);
  });

  it("passes a missing snapshot through as null", () => {
    expect(scopeFlyInventory(null, ["x"])).toBeNull();
  });

  it("offers every app in the org", () => {
    expect(flyAppOptions(flyOrg).map((o) => o.id)).toEqual(["dali-api-prod", "ultrasound", "dali-kiosk"]);
    expect(flyAppOptions(null)).toEqual([]);
  });

  it("keeps Fly samples for linked apps only", () => {
    const fly = sample({ provider: "fly", scopeType: SCOPE.flyApp, scopeId: "ultrasound", metric: "egress_bytes" });
    expect(isSampleInScope(fly, { neonProjectIds: [], flyAppNames: ["ultrasound"] })).toBe(true);
    expect(isSampleInScope(fly, { neonProjectIds: [], flyAppNames: ["dali-api-prod"] })).toBe(false);
  });

  it("drops samples from an unknown provider", () => {
    expect(isSampleInScope(sample({ provider: "aws" }), { neonProjectIds: ["np-a"], flyAppNames: [] })).toBe(false);
  });
});

describe("knownOrgs", () => {
  type Inv = { org: string; items: string[] };
  const inv = (org: string, items: string[]): Inv => ({ org, items });
  const build = (orgIds: string[], snaps: (Inv | null)[]) =>
    knownOrgs(orgIds, snaps, (i) => i.org, (i) => i.items.map((id) => ({ id, name: id })));

  it("lists each configured org once, sorted, with its newest sweep", () => {
    expect(build(["org-b", "org-a", "org-b"], [inv("org-a", ["new"]), inv("org-a", ["old"]), inv("org-b", ["x"])])).toEqual([
      { orgId: "org-a", resources: [{ id: "new", name: "new" }] },
      { orgId: "org-b", resources: [{ id: "x", name: "x" }] },
    ]);
  });

  it("lists a configured org with no sweep yet as empty", () => {
    expect(build(["org-a"], [null])).toEqual([{ orgId: "org-a", resources: [] }]);
  });

  it("leaves out swept orgs no project uses", () => {
    expect(build([], [inv("org-a", ["x"])])).toEqual([]);
  });
});

describe("unlinkedResources", () => {
  const orgs = [
    { orgId: "dali-os", resources: [{ id: "web", name: "web" }, { id: "dali-api-pr-9", name: "dali-api-pr-9" }] },
    { orgId: "other", resources: [{ id: "taken", name: "taken" }] },
  ];

  it("lists what no project has linked, per org", () => {
    expect(unlinkedResources(orgs, ["web", "taken"])).toEqual([
      { orgId: "dali-os", resources: [{ id: "dali-api-pr-9", name: "dali-api-pr-9" }] },
    ]);
  });

  it("is empty when everything is linked", () => {
    expect(unlinkedResources(orgs, ["web", "dali-api-pr-9", "taken"])).toEqual([]);
  });
});

describe("neonDailyUsage", () => {
  const day = (iso: string, metric: string, value: number, scopeId = "np-a") =>
    sample({ scopeType: SCOPE.neonDaily, scopeId, metric, value, at: new Date(iso) });

  it("sums compute and data out per day across databases, oldest first", () => {
    expect(
      neonDailyUsage([
        day("2026-10-25T00:00:00Z", "compute_unit_seconds", 10),
        day("2026-10-24T00:00:00Z", "compute_unit_seconds", 5),
        day("2026-10-24T00:00:00Z", "compute_unit_seconds", 7, "np-c"),
        day("2026-10-24T00:00:00Z", "public_network_transfer_bytes", 100),
      ]),
    ).toEqual([
      { day: "2026-10-24", compute_unit_seconds: 12, public_network_transfer_bytes: 100 },
      { day: "2026-10-25", compute_unit_seconds: 10, public_network_transfer_bytes: 0 },
    ]);
  });

  it("leaves out other metrics and monthly, branch and Fly rows", () => {
    expect(
      neonDailyUsage([
        day("2026-10-24T00:00:00Z", "root_branch_bytes_month", 1e9),
        sample({ scopeType: SCOPE.neonMonth, at: OCT, value: 1e9 }),
        sample({ scopeType: SCOPE.neonBranchMonth, scopeId: "np-a:br", at: OCT, value: 1e9 }),
        sample({ provider: "fly", scopeType: SCOPE.flyApp, scopeId: "web", metric: "egress_bytes", value: 1e9 }),
      ]),
    ).toEqual([]);
  });
});

describe("flyDailyUsage", () => {
  const fly = (app: string, iso: string, metric: string, value: number, scopeType: string = SCOPE.flyDaily) =>
    sample({ provider: "fly", scopeType, scopeId: app, metric, value, at: new Date(iso) });

  it("collects one row per day and app, oldest first", () => {
    expect(
      flyDailyUsage([
        fly("web", "2026-10-25T00:00:00Z", "requests", 10),
        fly("web", "2026-10-24T00:00:00Z", "requests", 7),
        fly("web", "2026-10-24T00:00:00Z", "errors_5xx", 1),
        fly("web", "2026-10-24T00:00:00Z", "p95_ms", 300),
        fly("api", "2026-10-24T00:00:00Z", "memory_peak_bytes", 5e8),
      ]),
    ).toEqual([
      { day: "2026-10-24", app: "api", requests: 0, errors_5xx: 0, p95_ms: null, memory_peak_bytes: 5e8 },
      { day: "2026-10-24", app: "web", requests: 7, errors_5xx: 1, p95_ms: 300, memory_peak_bytes: null },
      { day: "2026-10-25", app: "web", requests: 10, errors_5xx: 0, p95_ms: null, memory_peak_bytes: null },
    ]);
  });

  it("leaves out hourly Fly rows and Neon rows", () => {
    expect(
      flyDailyUsage([
        fly("web", "2026-10-24T05:00:00Z", "egress_bytes", 10, SCOPE.flyApp),
        sample({ scopeType: SCOPE.neonDaily }),
      ]),
    ).toEqual([]);
  });
});

describe("flyDayTotals", () => {
  const row = (app: string, requests: number, p95: number | null, mem: number | null, day = "2026-10-24") => ({
    day,
    app,
    requests,
    errors_5xx: requests / 100,
    p95_ms: p95,
    memory_peak_bytes: mem,
  });
  const rows = [row("web", 1000, 300, 5e8), row("api", 200, 900, null), row("web", 50, null, null, "2026-10-25")];

  it("adds requests, errors and memory across apps and keeps the slowest p95", () => {
    expect(flyDayTotals(rows, null)).toEqual([
      { day: "2026-10-24", requests: 1200, errors_5xx: 12, p95_ms: 900, memory_peak_bytes: 5e8 },
      { day: "2026-10-25", requests: 50, errors_5xx: 0.5, p95_ms: null, memory_peak_bytes: null },
    ]);
  });

  it("narrows to one app", () => {
    expect(flyDayTotals(rows, "api")).toEqual([
      { day: "2026-10-24", requests: 200, errors_5xx: 2, p95_ms: 900, memory_peak_bytes: null },
    ]);
  });
});
