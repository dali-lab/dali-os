// Assembles the Infrastructure dashboard's read model from cached snapshots +
// the project registry + usage samples. Pure Postgres reads — never calls
// provider APIs (the infra-snapshot job does that). Also builds the cross-project
// cleanup review list (idle/orphan candidates, protected resources excluded).

import { prisma } from "~/lib/db";
import { listInfraProjects } from "./registry.server";
import { isFlyAppProtected, isNeonProjectProtected, protectedFlyApps, protectedNeonProjectIds } from "./guard.server";
import type { FlyInventory, NeonInventory } from "./types";

export type UsageSeries = { metric: string; points: { at: string; value: number }[] };

export type ProjectFleet = {
  key: string;
  label: string;
  enabled: boolean;
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
  fly: FlyInventory | null;
  neon: NeonInventory | null;
  flyFetchedAt: string | null;
  neonFetchedAt: string | null;
  usage: UsageSeries[];
};

export type CleanupCandidate = {
  projectKey: string;
  projectLabel: string;
  provider: "fly" | "neon";
  kind: string; // "fly-app" | "fly-machine" | "neon-branch" | "neon-endpoint"
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

export async function loadFleet(): Promise<{
  projects: ProjectFleet[];
  lastSweep: string | null;
  protectedFly: string[];
  protectedNeon: string[];
}> {
  const [registry, snapshots, samples] = await Promise.all([
    listInfraProjects(),
    prisma.infraSnapshot.findMany({ orderBy: { fetchedAt: "desc" } }),
    prisma.infraUsageSample.findMany({ orderBy: { at: "asc" }, take: 5000 }),
  ]);

  const latest = new Map<string, { payload: unknown; fetchedAt: Date }>();
  let lastSweep: Date | null = null;
  for (const s of snapshots) {
    const k = `${s.projectKey}:${s.provider}`;
    if (!latest.has(k)) latest.set(k, { payload: s.payload, fetchedAt: s.fetchedAt });
    if (!lastSweep || s.fetchedAt > lastSweep) lastSweep = s.fetchedAt;
  }

  // Group usage samples into per-project, per-metric series (capped points).
  const usageByProject = new Map<string, Map<string, { at: string; value: number }[]>>();
  for (const s of samples) {
    let byMetric = usageByProject.get(s.projectKey);
    if (!byMetric) {
      byMetric = new Map();
      usageByProject.set(s.projectKey, byMetric);
    }
    const arr = byMetric.get(s.metric) ?? [];
    arr.push({ at: s.at.toISOString(), value: s.value });
    byMetric.set(s.metric, arr);
  }

  const projects: ProjectFleet[] = registry.map((r) => {
    const fly = latest.get(`${r.key}:fly`);
    const neon = latest.get(`${r.key}:neon`);
    const usage: UsageSeries[] = [...(usageByProject.get(r.key)?.entries() ?? [])].map(
      ([metric, points]) => ({ metric, points: points.slice(-40) }),
    );
    return {
      key: r.key,
      label: r.label,
      enabled: r.enabled,
      flyOrgSlug: r.flyOrgSlug,
      neonOrgId: r.neonOrgId,
      hasFlyReadToken: r.hasFlyReadToken,
      hasFlyWriteToken: r.hasFlyWriteToken,
      fly: (fly?.payload as FlyInventory | undefined) ?? null,
      neon: (neon?.payload as NeonInventory | undefined) ?? null,
      flyFetchedAt: fly?.fetchedAt.toISOString() ?? null,
      neonFetchedAt: neon?.fetchedAt.toISOString() ?? null,
      usage,
    };
  });

  return {
    projects,
    lastSweep: lastSweep?.toISOString() ?? null,
    protectedFly: protectedFlyApps(),
    protectedNeon: protectedNeonProjectIds(),
  };
}

// Cross-project idle/orphan review list. Surfaces everything not on the
// protected allowlist, annotated with age + idleness, sorted most-idle first.
// No auto-classification — Admin decides per row.
export function buildCleanup(projects: ProjectFleet[], now = Date.now()): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];

  for (const p of projects) {
    // Fly: apps whose machines are all stopped/suspended read as idle.
    for (const app of p.fly?.apps ?? []) {
      const machines = app.machines ?? [];
      const running = machines.filter((m) => m.state === "started").length;
      if (machines.length > 0 && running === 0) {
        const oldest = machines
          .map((m) => daysSince(m.createdAt, now))
          .filter((d): d is number => d != null)
          .sort((a, b) => b - a)[0];
        out.push({
          projectKey: p.key,
          projectLabel: p.label,
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

    // Neon: non-default branches (ephemeral/preview-shaped) and idle endpoints.
    for (const proj of p.neon?.projects ?? []) {
      const prot = isNeonProjectProtected(proj.id);
      for (const b of proj.branches ?? []) {
        if (b.default) continue;
        out.push({
          projectKey: p.key,
          projectLabel: p.label,
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
          projectKey: p.key,
          projectLabel: p.label,
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

  // Most idle first, then oldest; protected rows sink to the bottom.
  return out.sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? 1 : -1;
    return (b.idleDays ?? b.ageDays ?? 0) - (a.idleDays ?? a.ageDays ?? 0);
  });
}
