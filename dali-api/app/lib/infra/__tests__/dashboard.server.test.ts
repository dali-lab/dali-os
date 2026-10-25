import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("../vaultwarden.server", () => ({
  vaultwardenConfigured: () => process.env.TEST_VW === "1",
  vaultMembersUrl: () => "https://vault.example.edu/#/organizations/org/members",
}));

import { buildProjectFleet, buildUnlinkedFleet, unlinkedVaultGroups } from "../dashboard.server";
import type { VaultInventory } from "../types";
import type { InfraProjectInfo } from "../project-infra.server";
import type { NeonInventory } from "../types";

const info = (over: Partial<InfraProjectInfo> = {}): InfraProjectInfo => ({
  projectId: "p1",
  name: "Work Health",
  flyOrgSlug: null,
  flyAppNames: [],
  neonOrgId: "org-dali-1",
  neonProjectIds: ["np-a"],
  vaultwardenGroupId: null,
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

  it("keeps Fly usage for linked apps regardless of linked databases", () => {
    const fleet = buildProjectFleet(info({ neonProjectIds: [], flyAppNames: ["web"] }), latest, [
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


const flyApp = (name: string) => ({ id: name, name, status: "deployed", machineCount: 0, machines: [], volumes: [] });
const flyOrg = { orgSlug: "dali-os", apps: [flyApp("dali-api-prod"), flyApp("ultrasound"), flyApp("dali-api-pr-9")] };

describe("buildProjectFleet Fly", () => {
  const withFly = new Map([...latest, ["p1:fly", { payload: flyOrg as unknown, fetchedAt }]]);

  it("shows only the project's linked apps and offers the whole org", () => {
    const fleet = buildProjectFleet(info({ flyOrgSlug: "dali-os", flyAppNames: ["ultrasound"] }), withFly, []);
    expect(fleet.fly?.apps.map((a) => a.name)).toEqual(["ultrasound"]);
    expect(fleet.flyOrgApps.map((a) => a.id)).toEqual(["dali-api-prod", "ultrasound", "dali-api-pr-9"]);
  });

  it("marks a project with no Fly or Neon org as not configured", () => {
    expect(buildProjectFleet(info({ neonOrgId: null, flyOrgSlug: null }), new Map(), []).configured).toBe(false);
    expect(buildProjectFleet(info(), latest, []).configured).toBe(true);
  });
});

describe("buildUnlinkedFleet", () => {
  const dali = info({
    projectId: "p1",
    name: "DALI OS",
    flyOrgSlug: "dali-os",
    flyAppNames: ["dali-api-prod"],
    hasFlyReadToken: true,
    neonProjectIds: ["np-a"],
  });
  const ultrasound = info({ projectId: "p2", name: "Ultrasound", flyOrgSlug: "dali-os", flyAppNames: ["ultrasound"], neonProjectIds: [] });
  const snaps = new Map<string, { payload: unknown; fetchedAt: Date }>([
    ["p1:fly", { payload: flyOrg, fetchedAt }],
    ["p1:neon", { payload: { ...org, plan: "launch" }, fetchedAt }],
  ]);
  const orgs = {
    fly: [{ orgId: "dali-os", resources: flyOrg.apps.map((a) => ({ id: a.name, name: a.name })) }],
    neon: [{ orgId: "org-dali-1", resources: org.projects.map((p) => ({ id: p.id, name: p.name })) }],
    vaultGroups: null,
    vaultCollections: [],
  };

  it("lists apps and databases no project has linked, one row per org", () => {
    const rows = buildUnlinkedFleet([dali, ultrasound], snaps, orgs);
    expect(rows.map((r) => r.name)).toEqual(["Not linked · Fly dali-os", "Not linked · Neon org-dali-1"]);
    expect(rows[0].fly?.apps.map((a) => a.name)).toEqual(["dali-api-pr-9"]);
    expect(rows[1].neon?.projects.map((p) => p.id)).toEqual(["np-b"]);
    expect(rows.every((r) => r.unlinked)).toBe(true);
  });

  it("acts through a project already in the org", () => {
    const [fly] = buildUnlinkedFleet([dali, ultrasound], snaps, orgs);
    expect(fly.projectId).toBe("p1");
    expect(fly.neon).toBeNull();
  });

  it("is empty when everything is linked", () => {
    const all = info({ ...dali, flyAppNames: flyOrg.apps.map((a) => a.name), neonProjectIds: ["np-a", "np-b"] });
    expect(buildUnlinkedFleet([all], snaps, orgs)).toEqual([]);
  });

  it("skips an org with no swept inventory", () => {
    expect(buildUnlinkedFleet([dali], new Map(), orgs)).toEqual([]);
  });
});

const vaultInv: VaultInventory = {
  orgId: "org",
  members: [{ id: "m1", email: "ada@example.edu", name: "Ada", status: 2, type: 2, twoFactorEnabled: true }],
  groups: [
    { id: "g1", name: "Work Health", externalId: null, memberIds: ["m1"], collectionIds: [] },
    { id: "g2", name: "Lonely", externalId: null, memberIds: [], collectionIds: [] },
  ],
  collections: [],
};

describe("buildProjectFleet Vaultwarden", () => {
  it("compares the linked group with the project's roster", () => {
    const fleet = buildProjectFleet(info({ vaultwardenGroupId: "g1" }), latest, [], {
      vaultInventory: vaultInv,
      roster: [
        { userId: "u1", name: "Ada", email: "ada@example.edu" },
        { userId: "u2", name: "Grace", email: "grace@example.edu" },
      ],
    });
    expect(fleet.vault?.group.name).toBe("Work Health");
    expect(fleet.vault?.members[0].staffed).toBe(true);
    expect(fleet.vault?.missing.map((p) => p.name)).toEqual(["Grace"]);
  });

  it("has no vault without a linked group", () => {
    expect(buildProjectFleet(info(), latest, [], { vaultInventory: vaultInv }).vault).toBeNull();
  });

  it("counts a linked group alone as configured", () => {
    expect(buildProjectFleet(info({ neonOrgId: null, vaultwardenGroupId: "g1" }), new Map(), []).configured).toBe(true);
  });

  it("links the web vault's member page only when Vaultwarden is configured", () => {
    delete process.env.TEST_VW;
    expect(buildProjectFleet(info(), latest, []).vaultMembersUrl).toBeNull();
    process.env.TEST_VW = "1";
    expect(buildProjectFleet(info(), latest, []).vaultMembersUrl).toBe("https://vault.example.edu/#/organizations/org/members");
    delete process.env.TEST_VW;
  });
});

describe("unlinkedVaultGroups", () => {
  it("lists groups no project links, with member counts", () => {
    expect(unlinkedVaultGroups(vaultInv, [{ vaultwardenGroupId: "g1" }, { vaultwardenGroupId: null }])).toEqual([
      { id: "g2", name: "Lonely", memberCount: 0 },
    ]);
  });

  it("is empty before the first sweep", () => {
    expect(unlinkedVaultGroups(null, [])).toEqual([]);
  });
});
