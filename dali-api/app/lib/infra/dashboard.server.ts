// Assembles the Infrastructure read model from cached snapshots + per-project
// config (on Project) + usage samples. Pure Postgres reads — never calls
// provider APIs (the infra-snapshot job does that). Also builds the cross-project
// cleanup review list (idle/orphan candidates, protected resources excluded).

import { prisma } from "~/lib/db";
import { listInfraProjects, type InfraProjectInfo } from "./project-infra.server";
import {
  isFlyAppProtected,
  isNeonProjectProtected,
  protectedFlyApps,
  protectedNeonProjectIds,
} from "./guard.server";
import { monthStart } from "./neon-cost";
import {
  branchUsage,
  isSampleInScope,
  neonCostSummary,
  neonProjectOptions,
  projectUsage,
  scopeNeonInventory,
  type NeonBranchUsage,
  type NeonCostSummary,
  type ScopedSample,
  type UsageSeries,
} from "./neon-scope";
import type { FlyInventory, NeonInventory } from "./types";

export type { UsageSeries };

export type ProjectFleet = {
  projectId: string;
  name: string;
  infraEnabled: boolean;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  neonProjectIds: string[];
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
  fly: FlyInventory | null;
  neon: NeonInventory | null;
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
  now = new Date(),
): ProjectFleet {
  const fly = latest.get(`${info.projectId}:fly`);
  const neon = latest.get(`${info.projectId}:neon`);
  const orgInventory = (neon?.payload as NeonInventory | undefined) ?? null;
  const scoped = scopeNeonInventory(orgInventory, info.neonProjectIds);
  const mine = samples.filter(
    (s) => s.projectId === info.projectId && isSampleInScope(s, info.neonProjectIds),
  );
  const neonPlan = orgInventory?.plan ?? null;
  return {
    projectId: info.projectId,
    name: info.name,
    infraEnabled: info.infraEnabled,
    flyOrgSlug: info.flyOrgSlug,
    neonOrgId: info.neonOrgId,
    neonProjectIds: info.neonProjectIds,
    hasFlyReadToken: info.hasFlyReadToken,
    hasFlyWriteToken: info.hasFlyWriteToken,
    fly: (fly?.payload as FlyInventory | undefined) ?? null,
    neon: scoped,
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

export async function loadFleet(): Promise<{
  projects: ProjectFleet[];
  lastSweep: string | null;
  protectedFly: string[];
  protectedNeon: string[];
}> {
  const [registry, snapshots, samples] = await Promise.all([
    listInfraProjects(),
    prisma.infraSnapshot.findMany({ orderBy: { fetchedAt: "desc" } }),
    prisma.infraUsageSample.findMany({ where: recentSamplesWhere(new Date()), orderBy: { at: "asc" } }),
  ]);

  const { latest, lastSweep } = latestByProviderKey(snapshots);
  const projects = registry.map((info) => buildProjectFleet(info, latest, samples));

  return {
    projects,
    lastSweep: lastSweep?.toISOString() ?? null,
    protectedFly: protectedFlyApps(),
    protectedNeon: protectedNeonProjectIds(),
  };
}

// Single-project read model for the per-project Infrastructure section. Returns
// null when the project has no infra configured.
export async function loadProjectInfra(projectId: string): Promise<ProjectFleet | null> {
  const info = (await listInfraProjects()).find((p) => p.projectId === projectId);
  if (!info) return null;
  const [snapshots, samples] = await Promise.all([
    prisma.infraSnapshot.findMany({ where: { projectId }, orderBy: { fetchedAt: "desc" } }),
    prisma.infraUsageSample.findMany({
      where: { projectId, ...recentSamplesWhere(new Date()) },
      orderBy: { at: "asc" },
    }),
  ]);
  const { latest } = latestByProviderKey(snapshots);
  return buildProjectFleet(info, latest, samples);
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

export type KnownNeonOrg = { orgId: string; projects: { id: string; name: string }[] };

// Neon orgs already configured on some project, each with the databases from
// its latest sweep, so the config editor can reuse an org without retyping it
// and list its databases before this project's first sweep.
export async function listKnownNeonOrgs(): Promise<KnownNeonOrg[]> {
  const [configured, snapshots] = await Promise.all([
    prisma.project.findMany({
      where: { neonOrgId: { not: null } },
      select: { neonOrgId: true },
      distinct: ["neonOrgId"],
    }),
    prisma.infraSnapshot.findMany({
      where: { provider: "neon" },
      orderBy: { fetchedAt: "desc" },
      select: { payload: true },
    }),
  ]);
  return knownNeonOrgs(
    configured.map((c) => c.neonOrgId!),
    snapshots.map((s) => s.payload as NeonInventory | null),
  );
}

export function knownNeonOrgs(orgIds: string[], newestFirst: (NeonInventory | null)[]): KnownNeonOrg[] {
  const latest = new Map<string, NeonInventory>();
  for (const inv of newestFirst) if (inv?.orgId && !latest.has(inv.orgId)) latest.set(inv.orgId, inv);
  return [...new Set(orgIds)].sort().map((orgId) => ({
    orgId,
    projects: neonProjectOptions(latest.get(orgId) ?? null),
  }));
}
