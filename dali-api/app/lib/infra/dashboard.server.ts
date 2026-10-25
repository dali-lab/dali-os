// Assembles the Infrastructure read model from cached snapshots + per-project
// config (on Project) + usage samples. Pure Postgres reads — never calls
// provider APIs (the infra-snapshot job does that). Also builds the cross-project
// cleanup review list (idle/orphan candidates, protected resources excluded).

import { prisma } from "~/lib/db";
import {
  getInfraProjectInfo,
  hasInfraConfig,
  listInfraProjects,
  type InfraProjectInfo,
} from "./project-infra.server";
import {
  isFlyAppProtected,
  isNeonProjectProtected,
  protectedFlyApps,
  protectedNeonProjectIds,
} from "./guard.server";
import { monthStart } from "./neon-cost";
import {
  branchUsage,
  flyAppOptions,
  isSampleInScope,
  knownOrgs,
  neonCostSummary,
  neonProjectOptions,
  projectUsage,
  scopeFlyInventory,
  scopeNeonInventory,
  unlinkedResources,
  type KnownOrg,
  type NeonBranchUsage,
  type NeonCostSummary,
  type ScopedSample,
  type UsageSeries,
} from "./infra-scope";
import type { FlyInventory, NeonInventory, VaultInventory } from "./types";
import {
  collectionLabel,
  projectVault,
  vaultGroupOptions,
  VAULT_ORG_SNAPSHOT,
  type ProjectVault,
  type RosterPerson,
} from "./vault-scope";
import { latestVaultInventory, loadVaultRosters } from "./vault-read.server";
import { vaultMembersUrl, vaultwardenConfigured } from "./vaultwarden.server";

export type { UsageSeries };

export type ProjectFleet = {
  projectId: string;
  name: string;
  infraEnabled: boolean;
  /** False when no Fly or Neon config is set; the console shows it as not configured. */
  configured: boolean;
  /** Set on the console's "not linked" rows: org resources no project has claimed. */
  unlinked?: boolean;
  flyOrgSlug: string | null;
  flyAppNames: string[];
  neonOrgId: string | null;
  neonProjectIds: string[];
  vaultwardenGroupId: string | null;
  /** The project's Vaultwarden group against its staffing; null when none is linked or swept. */
  vault: ProjectVault | null;
  /** Web vault page where a human confirms members; null when not configured. */
  vaultMembersUrl: string | null;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
  fly: FlyInventory | null;
  neon: NeonInventory | null;
  /** Every app in the swept Fly org, for picking which belong here. */
  flyOrgApps: { id: string; name: string }[];
  /** Every database in the swept Neon org, for picking which belong here. */
  neonOrgProjects: { id: string; name: string }[];
  neonPlan: string | null;
  /** Estimated dollars; null when the plan's rates are unknown. */
  neonCost: NeonCostSummary | null;
  /** This month's per-branch usage, keyed by Neon project id. */
  neonBranchUsage: Record<string, NeonBranchUsage[]>;
  flyFetchedAt: string | null;
  neonFetchedAt: string | null;
  usage: UsageSeries[];
};

export type CleanupCandidate = {
  projectId: string;
  projectName: string;
  provider: "fly" | "neon";
  kind: string; // "fly-app" | "neon-branch" | "neon-endpoint"
  resourceId: string;
  name: string;
  detail: string;
  ageDays: number | null;
  idleDays: number | null;
  protected: boolean;
};

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
}

type Snapshot = { projectId: string; provider: string; payload: unknown; fetchedAt: Date };
type Sample = ScopedSample & { projectId: string };

export function buildProjectFleet(
  info: InfraProjectInfo,
  latest: Map<string, { payload: unknown; fetchedAt: Date }>,
  samples: Sample[],
  opts: { now?: Date; vaultInventory?: VaultInventory | null; roster?: RosterPerson[] } = {},
): ProjectFleet {
  const now = opts.now ?? new Date();
  const fly = latest.get(`${info.projectId}:fly`);
  const neon = latest.get(`${info.projectId}:neon`);
  const flyOrg = (fly?.payload as FlyInventory | undefined) ?? null;
  const orgInventory = (neon?.payload as NeonInventory | undefined) ?? null;
  const scoped = scopeNeonInventory(orgInventory, info.neonProjectIds);
  const mine = samples.filter((s) => s.projectId === info.projectId && isSampleInScope(s, info));
  const neonPlan = orgInventory?.plan ?? null;
  return {
    projectId: info.projectId,
    name: info.name,
    infraEnabled: info.infraEnabled,
    configured: hasInfraConfig(info),
    flyOrgSlug: info.flyOrgSlug,
    flyAppNames: info.flyAppNames,
    neonOrgId: info.neonOrgId,
    neonProjectIds: info.neonProjectIds,
    vaultwardenGroupId: info.vaultwardenGroupId,
    vault: projectVault(opts.vaultInventory ?? null, info.vaultwardenGroupId, opts.roster ?? []),
    vaultMembersUrl: vaultwardenConfigured() ? vaultMembersUrl() : null,
    hasFlyReadToken: info.hasFlyReadToken,
    hasFlyWriteToken: info.hasFlyWriteToken,
    fly: scopeFlyInventory(flyOrg, info.flyAppNames),
    neon: scoped,
    flyOrgApps: flyAppOptions(flyOrg),
    neonOrgProjects: neonProjectOptions(orgInventory),
    neonPlan,
    neonCost: neonCostSummary(mine, neonPlan, now),
    neonBranchUsage: branchUsage(mine, scoped, now),
    flyFetchedAt: fly?.fetchedAt.toISOString() ?? null,
    neonFetchedAt: neon?.fetchedAt.toISOString() ?? null,
    usage: projectUsage(mine, now),
  };
}

const FLY_SAMPLE_DAYS = 3;

// Neon rows back to last month's start (estimates + daily sparklines); Fly rows
// are hourly per app, so a few days covers the 40-point sparkline.
function recentSamplesWhere(now: Date) {
  return {
    OR: [
      { provider: "neon", at: { gte: monthStart(now, -1) } },
      { provider: "fly", at: { gte: new Date(now.getTime() - FLY_SAMPLE_DAYS * 86_400_000) } },
    ],
  };
}

function latestByProviderKey(snapshots: Snapshot[]): {
  latest: Map<string, { payload: unknown; fetchedAt: Date }>;
  lastSweep: Date | null;
} {
  const latest = new Map<string, { payload: unknown; fetchedAt: Date }>();
  let lastSweep: Date | null = null;
  for (const s of snapshots) {
    const k = `${s.projectId}:${s.provider}`;
    if (!latest.has(k)) latest.set(k, { payload: s.payload, fetchedAt: s.fetchedAt });
    if (!lastSweep || s.fetchedAt > lastSweep) lastSweep = s.fetchedAt;
  }
  return { latest, lastSweep };
}

export type KnownOrgs = {
  fly: KnownOrg[];
  neon: KnownOrg[];
  /** Groups in the Vaultwarden org; null when Vaultwarden isn't configured. */
  vaultGroups: { id: string; name: string }[] | null;
  /** Collections in the Vaultwarden org, labeled by external id or short id. */
  vaultCollections: { id: string; name: string }[];
};

function knownOrgsFrom(
  projects: { flyOrgSlug: string | null; neonOrgId: string | null }[],
  snapshotsNewestFirst: Snapshot[],
): KnownOrgs {
  const vault = snapshotsNewestFirst.find((s) => s.provider === "vaultwarden")?.payload as VaultInventory | undefined;
  const payloads = (provider: string) =>
    snapshotsNewestFirst.filter((s) => s.provider === provider).map((s) => s.payload);
  return {
    fly: knownOrgs(
      projects.flatMap((p) => (p.flyOrgSlug ? [p.flyOrgSlug] : [])),
      payloads("fly") as (FlyInventory | null)[],
      (inv) => inv.orgSlug,
      (inv) => flyAppOptions(inv),
    ),
    neon: knownOrgs(
      projects.flatMap((p) => (p.neonOrgId ? [p.neonOrgId] : [])),
      payloads("neon") as (NeonInventory | null)[],
      (inv) => inv.orgId,
      (inv) => neonProjectOptions(inv),
    ),
    vaultGroups: vaultwardenConfigured() ? vaultGroupOptions(vault ?? null) : null,
    vaultCollections: (vault?.collections ?? []).map((c) => ({ id: c.id, name: collectionLabel(c) })),
  };
}

/** Orgs in use on any project, with their apps / databases from the newest sweep. */
export async function listKnownOrgs(): Promise<KnownOrgs> {
  const [configured, snapshots] = await Promise.all([
    listInfraProjects(),
    prisma.infraSnapshot.findMany({ orderBy: { fetchedAt: "desc" } }),
  ]);
  return knownOrgsFrom(configured, snapshots);
}

/**
 * Console rows for org resources no project has linked, one per org, so they
 * still show (and stay in cleanup) after projects scope to their own. Actions
 * on them run with the credentials of a project already in that org.
 */
export function buildUnlinkedFleet(
  configured: InfraProjectInfo[],
  latest: Map<string, { payload: unknown; fetchedAt: Date }>,
  orgs: KnownOrgs,
): ProjectFleet[] {
  const out: ProjectFleet[] = [];
  const blank = (donor: InfraProjectInfo, name: string): ProjectFleet => ({
    ...buildProjectFleet({ ...donor, flyAppNames: [], neonProjectIds: [], vaultwardenGroupId: null }, new Map(), []),
    name,
    unlinked: true,
  });
  for (const { orgId, resources } of unlinkedResources(orgs.fly, configured.flatMap((p) => p.flyAppNames))) {
    const donor = configured.find((p) => p.flyOrgSlug === orgId && p.hasFlyReadToken);
    const inv = donor ? (latest.get(`${donor.projectId}:fly`)?.payload as FlyInventory | undefined) : undefined;
    if (!donor || !inv) continue;
    out.push({
      ...blank({ ...donor, neonOrgId: null }, `Not linked · Fly ${orgId}`),
      fly: scopeFlyInventory(inv, resources.map((r) => r.id)),
    });
  }
  for (const { orgId, resources } of unlinkedResources(orgs.neon, configured.flatMap((p) => p.neonProjectIds))) {
    const donor = configured.find((p) => p.neonOrgId === orgId);
    const inv = donor ? (latest.get(`${donor.projectId}:neon`)?.payload as NeonInventory | undefined) : undefined;
    if (!donor || !inv) continue;
    out.push({
      ...blank({ ...donor, flyOrgSlug: null }, `Not linked · Neon ${orgId}`),
      neon: scopeNeonInventory(inv, resources.map((r) => r.id)),
      neonPlan: inv.plan ?? null,
    });
  }
  return out;
}

export async function loadFleet(opts: { termId?: string | null; all?: boolean } = {}): Promise<{
  projects: ProjectFleet[];
  unlinked: ProjectFleet[];
  /** Vaultwarden groups no project has linked. */
  unlinkedVaultGroups: { id: string; name: string; memberCount: number }[];
  knownOrgs: KnownOrgs;
  lastSweep: string | null;
  protectedFly: string[];
  protectedNeon: string[];
}> {
  const [registry, configured, snapshots, samples] = await Promise.all([
    listInfraProjects({ all: opts.all, termId: opts.termId }),
    listInfraProjects(),
    prisma.infraSnapshot.findMany({ orderBy: { fetchedAt: "desc" } }),
    prisma.infraUsageSample.findMany({ where: recentSamplesWhere(new Date()), orderBy: { at: "asc" } }),
  ]);

  const { latest, lastSweep } = latestByProviderKey(snapshots);
  const orgs = knownOrgsFrom(configured, snapshots);
  const vaultInventory = vaultFrom(snapshots);
  const rosters = await loadVaultRosters(registry.filter((p) => p.vaultwardenGroupId).map((p) => p.projectId));

  return {
    projects: registry.map((info) =>
      buildProjectFleet(info, latest, samples, { vaultInventory, roster: rosters.get(info.projectId) }),
    ),
    unlinked: buildUnlinkedFleet(configured, latest, orgs),
    unlinkedVaultGroups: unlinkedVaultGroups(vaultInventory, configured),
    knownOrgs: orgs,
    lastSweep: lastSweep?.toISOString() ?? null,
    protectedFly: protectedFlyApps(),
    protectedNeon: protectedNeonProjectIds(),
  };
}

// Single-project read model for the per-project Infrastructure section. Returns
// null when the project has no infra configured.
export async function loadProjectInfra(projectId: string): Promise<ProjectFleet | null> {
  const info = await getInfraProjectInfo(projectId);
  if (!info || !hasInfraConfig(info)) return null;
  const [snapshots, samples, vaultInventory, rosters] = await Promise.all([
    prisma.infraSnapshot.findMany({ where: { projectId }, orderBy: { fetchedAt: "desc" } }),
    prisma.infraUsageSample.findMany({
      where: { projectId, ...recentSamplesWhere(new Date()) },
      orderBy: { at: "asc" },
    }),
    info.vaultwardenGroupId ? latestVaultInventory() : Promise.resolve(null),
    info.vaultwardenGroupId ? loadVaultRosters([projectId]) : Promise.resolve(new Map<string, RosterPerson[]>()),
  ]);
  const { latest } = latestByProviderKey(snapshots);
  return buildProjectFleet(info, latest, samples, { vaultInventory, roster: rosters.get(projectId) });
}

function vaultFrom(snapshotsNewestFirst: Snapshot[]): VaultInventory | null {
  const s = snapshotsNewestFirst.find((x) => x.provider === "vaultwarden" && x.projectId === VAULT_ORG_SNAPSHOT);
  return (s?.payload as VaultInventory | undefined) ?? null;
}

export function unlinkedVaultGroups(
  inv: VaultInventory | null,
  configured: { vaultwardenGroupId: string | null }[],
): { id: string; name: string; memberCount: number }[] {
  const linked = new Set(configured.map((p) => p.vaultwardenGroupId).filter(Boolean));
  return (inv?.groups ?? [])
    .filter((g) => !linked.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberIds.length }));
}

// Cross-project idle/orphan review list. Surfaces everything not on the
// protected allowlist, annotated with age + idleness, sorted most-idle first.
export function buildCleanup(projects: ProjectFleet[], now = Date.now()): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];

  for (const p of projects) {
    for (const app of p.fly?.apps ?? []) {
      const machines = app.machines ?? [];
      const running = machines.filter((m) => m.state === "started").length;
      if (machines.length > 0 && running === 0) {
        const oldest = machines
          .map((m) => daysSince(m.createdAt, now))
          .filter((d): d is number => d != null)
          .sort((a, b) => b - a)[0];
        out.push({
          projectId: p.projectId,
          projectName: p.name,
          provider: "fly",
          kind: "fly-app",
          resourceId: app.name,
          name: app.name,
          detail: `${machines.length} machine(s), none running`,
          ageDays: oldest ?? null,
          idleDays: oldest ?? null,
          protected: isFlyAppProtected(app.name),
        });
      }
    }

    for (const proj of p.neon?.projects ?? []) {
      const prot = isNeonProjectProtected(proj.id);
      for (const b of proj.branches ?? []) {
        if (b.default) continue;
        out.push({
          projectId: p.projectId,
          projectName: p.name,
          provider: "neon",
          kind: "neon-branch",
          resourceId: `${proj.id}:${b.id}`,
          name: `${proj.name} / ${b.name}`,
          detail: "non-default branch",
          ageDays: daysSince(b.createdAt, now),
          idleDays: null,
          protected: prot,
        });
      }
      for (const e of proj.endpoints ?? []) {
        if (e.currentState !== "idle") continue;
        out.push({
          projectId: p.projectId,
          projectName: p.name,
          provider: "neon",
          kind: "neon-endpoint",
          resourceId: `${proj.id}:${e.id}`,
          name: `${proj.name} / ${e.id}`,
          detail: `idle ${e.type} compute`,
          ageDays: null,
          idleDays: daysSince(e.lastActive, now),
          protected: prot,
        });
      }
    }
  }

  return out.sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? 1 : -1;
    return (b.idleDays ?? b.ageDays ?? 0) - (a.idleDays ?? a.ageDays ?? 0);
  });
}
