import { describe, expect, it } from "vitest";
import {
  isSampleInScope,
  neonProjectOptions,
  scopeNeonInventory,
  usageSeries,
  type ScopedSample,
} from "../neon-scope";
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
    expect(isSampleInScope(sample({ scopeId: "np-a" }), ["np-a"])).toBe(true);
    expect(isSampleInScope(sample({ scopeId: "np-b" }), ["np-a"])).toBe(false);
    expect(isSampleInScope(sample({ scopeId: "np-a" }), [])).toBe(false);
  });

  it("always keeps Fly samples", () => {
    const fly = sample({ provider: "fly", scopeType: "fly-app", scopeId: "web", metric: "egress_bytes" });
    expect(isSampleInScope(fly, [])).toBe(true);
  });
});

describe("usageSeries", () => {
  it("sums samples that share a metric and time", () => {
    const series = usageSeries([
      sample({ scopeId: "np-a", value: 3600 }),
      sample({ scopeId: "np-c", value: 1800 }),
    ]);
    expect(series).toEqual([
      { metric: "compute_unit_seconds", points: [{ at: "2026-10-01T00:00:00.000Z", value: 5400 }] },
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
