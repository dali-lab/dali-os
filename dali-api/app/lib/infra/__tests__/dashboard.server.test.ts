import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));

import { buildProjectFleet, knownNeonOrgs } from "../dashboard.server";
import type { InfraProjectInfo } from "../project-infra.server";
import type { NeonInventory } from "../types";

const info = (over: Partial<InfraProjectInfo> = {}): InfraProjectInfo => ({
  projectId: "p1",
  name: "Work Health",
  flyOrgSlug: null,
  neonOrgId: "org-dali-1",
  neonProjectIds: ["np-a"],
  infraEnabled: true,
  hasFlyReadToken: false,
  hasFlyWriteToken: false,
  ...over,
});

const quota = {
  activeTimeSeconds: null,
  computeTimeSeconds: null,
  writtenDataBytes: null,
  dataTransferBytes: null,
  logicalSizeBytes: null,
};
const org: NeonInventory = {
  orgId: "org-dali-1",
  projects: ["np-a", "np-b"].map((id) => ({
    id,
    name: id.toUpperCase(),
    regionId: "aws-us-east-1",
    pgVersion: 17,
    createdAt: null,
    quota,
    branches: [],
    endpoints: [],
  })),
};
const fetchedAt = new Date("2026-10-25T12:00:00Z");
const latest = new Map([["p1:neon", { payload: org as unknown, fetchedAt }]]);
const at = new Date("2026-10-01T00:00:00Z");
const neonSample = (projectId: string, scopeId: string, value: number) => ({
  projectId,
  provider: "neon",
  scopeType: "neon-project",
  scopeId,
  metric: "compute_unit_seconds",
  value,
  at,
});

describe("buildProjectFleet", () => {
  it("shows only the project's linked Neon databases", () => {
    const fleet = buildProjectFleet(info(), latest, []);
    expect(fleet.neon?.projects.map((p) => p.id)).toEqual(["np-a"]);
  });

  it("offers every org database for the picker", () => {
    const fleet = buildProjectFleet(info(), latest, []);
    expect(fleet.neonOrgProjects).toEqual([
      { id: "np-a", name: "NP-A" },
      { id: "np-b", name: "NP-B" },
    ]);
  });

  it("shows no Neon databases when none are linked", () => {
    const fleet = buildProjectFleet(info({ neonProjectIds: [] }), latest, []);
    expect(fleet.neon?.projects).toEqual([]);
    expect(fleet.neonOrgProjects).toHaveLength(2);
  });

  it("counts usage from linked databases only", () => {
    const fleet = buildProjectFleet(info(), latest, [
      neonSample("p1", "np-a", 3600),
      neonSample("p1", "np-b", 7200),
    ]);
    expect(fleet.usage).toEqual([
      { metric: "compute_unit_seconds", points: [{ at: at.toISOString(), value: 3600 }], current: 3600 },
    ]);
  });

  it("ignores another project's usage rows", () => {
    const fleet = buildProjectFleet(info(), latest, [neonSample("p2", "np-a", 3600)]);
    expect(fleet.usage).toEqual([]);
  });

  it("keeps Fly usage regardless of linked databases", () => {
    const fleet = buildProjectFleet(info({ neonProjectIds: [] }), latest, [
      { projectId: "p1", provider: "fly", scopeType: "fly-app", scopeId: "web", metric: "egress_bytes", value: 10, at },
    ]);
    expect(fleet.usage.map((u) => u.metric)).toEqual(["egress_bytes"]);
  });

  it("is empty when the project has never been swept", () => {
    const fleet = buildProjectFleet(info(), new Map(), []);
    expect(fleet.neon).toBeNull();
    expect(fleet.neonOrgProjects).toEqual([]);
    expect(fleet.neonFetchedAt).toBeNull();
  });
});

describe("knownNeonOrgs", () => {
  const inv = (orgId: string, ids: string[]): NeonInventory => ({
    orgId,
    projects: ids.map((id) => ({ ...org.projects[0], id, name: id })),
  });

  it("lists each configured org once, sorted, with its newest sweep's databases", () => {
    expect(
      knownNeonOrgs(["org-b", "org-a", "org-b"], [inv("org-a", ["new"]), inv("org-a", ["old"]), inv("org-b", ["x"])]),
    ).toEqual([
      { orgId: "org-a", projects: [{ id: "new", name: "new" }] },
      { orgId: "org-b", projects: [{ id: "x", name: "x" }] },
    ]);
  });

  it("lists a configured org with no sweep yet as empty", () => {
    expect(knownNeonOrgs(["org-a"], [])).toEqual([{ orgId: "org-a", projects: [] }]);
  });

  it("leaves out swept orgs no project uses anymore", () => {
    expect(knownNeonOrgs([], [inv("org-a", ["x"])])).toEqual([]);
  });

  it("skips empty snapshot payloads", () => {
    expect(knownNeonOrgs(["org-a"], [null])).toEqual([{ orgId: "org-a", projects: [] }]);
  });
});
