// The lab's Neon org is shared by every project, so the sweep caches the whole
// org and each project's view keeps only the Neon projects linked to it.

import { bucketHours, estimateNeonProjectMonth, monthStart } from "./neon-cost";
import type { NeonInventory } from "./types";

// Sample scopes the sweep writes. Daily and Fly rows draw the sparklines; the
// monthly rows hold month-to-date totals for the headline and cost estimates.
export const SCOPE = {
  neonDaily: "neon-project",
  neonMonth: "neon-project-month",
  neonBranchMonth: "neon-branch-month",
  flyApp: "fly-app",
} as const;

export function scopeNeonInventory(
  inv: NeonInventory | null,
  neonProjectIds: string[],
): NeonInventory | null {
  if (!inv) return null;
  const ids = new Set(neonProjectIds);
  return { ...inv, projects: inv.projects.filter((p) => ids.has(p.id)) };
}

export function neonProjectOptions(inv: NeonInventory | null): { id: string; name: string }[] {
  return (inv?.projects ?? []).map((p) => ({ id: p.id, name: p.name }));
}

export type ScopedSample = {
  provider: string;
  scopeType: string;
  scopeId: string;
  metric: string;
  value: number;
  at: Date;
};

export function branchScopeId(neonProjectId: string, branchId: string): string {
  return `${neonProjectId}:${branchId}`;
}

function neonProjectOf(s: ScopedSample): string {
  return s.scopeType === SCOPE.neonBranchMonth ? s.scopeId.split(":")[0] : s.scopeId;
}

export function isSampleInScope(s: ScopedSample, neonProjectIds: string[]): boolean {
  return s.provider !== "neon" || neonProjectIds.includes(neonProjectOf(s));
}

// One point per (metric, time): a project with several Fly apps or Neon
// databases reports the sum, not whichever sample came last.
export function usageSeries(
  samples: ScopedSample[],
  limit = 40,
): UsageSeries[] {
  const byMetric = new Map<string, Map<string, number>>();
  for (const s of [...samples].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const at = s.at.toISOString();
    const points = byMetric.get(s.metric) ?? new Map<string, number>();
    points.set(at, (points.get(at) ?? 0) + s.value);
    byMetric.set(s.metric, points);
  }
  return [...byMetric.entries()].map(([metric, points]) => {
    const all = [...points.entries()].map(([at, value]) => ({ at, value }));
    return { metric, points: all.slice(-limit), current: all[all.length - 1]?.value ?? null };
  });
}

export type UsageSeries = {
  metric: string;
  points: { at: string; value: number }[];
  /** Headline value: month to date for Neon, the latest reading for Fly. */
  current: number | null;
};

/**
 * Sparkline series for a project's in-scope samples. Neon headlines come from
 * the monthly rows (the daily points are one day each); series that are zero
 * throughout are dropped so unused metrics don't crowd the strip.
 */
export function projectUsage(samples: ScopedSample[], now: Date): UsageSeries[] {
  const thisMonth = monthStart(now).getTime();
  const monthToDate = new Map<string, number>();
  for (const s of samples) {
    if (s.scopeType !== SCOPE.neonMonth || s.at.getTime() !== thisMonth) continue;
    monthToDate.set(s.metric, (monthToDate.get(s.metric) ?? 0) + s.value);
  }
  return usageSeries(samples.filter((s) => s.scopeType === SCOPE.neonDaily || s.scopeType === SCOPE.flyApp))
    .map((u) => (monthToDate.has(u.metric) ? { ...u, current: monthToDate.get(u.metric)! } : u))
    .filter((u) => (u.current ?? 0) > 0 || u.points.some((p) => p.value > 0));
}

export type NeonBranchUsage = {
  branchId: string;
  name: string;
  computeSeconds: number;
  storageByteMonths: number;
  preview: boolean;
};

const PREVIEW_BRANCH = /^preview-pr-\d+$/;

/** This month's per-branch usage for each Neon project, heaviest compute first. */
export function branchUsage(
  samples: ScopedSample[],
  inv: NeonInventory | null,
  now: Date,
): Record<string, NeonBranchUsage[]> {
  const thisMonth = monthStart(now).getTime();
  const names = new Map<string, string>();
  for (const p of inv?.projects ?? []) {
    for (const b of p.branches) names.set(branchScopeId(p.id, b.id), b.name);
  }
  const rows = new Map<string, { projectId: string; row: NeonBranchUsage }>();
  for (const s of samples) {
    if (s.scopeType !== SCOPE.neonBranchMonth || s.at.getTime() !== thisMonth) continue;
    let entry = rows.get(s.scopeId);
    if (!entry) {
      const [projectId, branchId] = s.scopeId.split(":");
      const name = names.get(s.scopeId) ?? branchId;
      entry = {
        projectId,
        row: { branchId, name, computeSeconds: 0, storageByteMonths: 0, preview: PREVIEW_BRANCH.test(name) },
      };
      rows.set(s.scopeId, entry);
    }
    if (s.metric === "compute_unit_seconds") entry.row.computeSeconds += s.value;
    if (s.metric === "root_branch_bytes_month" || s.metric === "child_branch_bytes_month") {
      entry.row.storageByteMonths += s.value;
    }
  }
  const out: Record<string, NeonBranchUsage[]> = {};
  for (const { projectId, row } of rows.values()) (out[projectId] ??= []).push(row);
  for (const list of Object.values(out)) list.sort((a, b) => b.computeSeconds - a.computeSeconds);
  return out;
}

export type NeonCostSummary = {
  plan: string;
  thisMonth: number;
  lastMonth: number | null;
  byProject: Record<string, number>;
};

/** Estimated dollars from the monthly rows, or null when the plan has no known rates. */
export function neonCostSummary(
  samples: ScopedSample[],
  plan: string | null | undefined,
  now: Date,
): NeonCostSummary | null {
  if (!plan || estimateNeonProjectMonth({}, plan, 0) === null) return null;
  const current = monthStart(now);
  const previous = monthStart(now, -1);
  const buckets = new Map<string, Record<string, number>>();
  for (const s of samples) {
    if (s.scopeType !== SCOPE.neonMonth) continue;
    const t = s.at.getTime();
    if (t !== current.getTime() && t !== previous.getTime()) continue;
    const key = `${t}|${s.scopeId}`;
    const metrics = buckets.get(key) ?? {};
    metrics[s.metric] = (metrics[s.metric] ?? 0) + s.value;
    buckets.set(key, metrics);
  }
  let thisMonth = 0;
  let lastMonth: number | null = null;
  const byProject: Record<string, number> = {};
  for (const [key, metrics] of buckets) {
    const [t, projectId] = key.split("|");
    const month = new Date(Number(t));
    const total = estimateNeonProjectMonth(metrics, plan, bucketHours(month, now))!.total;
    if (month.getTime() === current.getTime()) {
      thisMonth += total;
      byProject[projectId] = (byProject[projectId] ?? 0) + total;
    } else {
      lastMonth = (lastMonth ?? 0) + total;
    }
  }
  return { plan, thisMonth, lastMonth, byProject };
}

/**
 * Database choices for the config editor's org. A linked id missing from the
 * org's latest sweep still shows (by id) so it can be removed.
 */
export function neonDatabaseOptions(
  orgId: string,
  knownOrgs: { orgId: string; projects: { id: string; name: string }[] }[],
  linkedIds: string[],
): { value: string; label: string }[] {
  const projects = knownOrgs.find((o) => o.orgId === orgId)?.projects ?? [];
  return [
    ...projects.map((p) => ({ value: p.id, label: p.name })),
    ...linkedIds.filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ value: id, label: id })),
  ];
}

/** Linked ids that still belong to the org after switching it. */
export function keepLinkedInOrg(
  orgId: string,
  knownOrgs: { orgId: string; projects: { id: string; name: string }[] }[],
  linkedIds: string[],
): string[] {
  const ids = new Set(knownOrgs.find((o) => o.orgId === orgId)?.projects.map((p) => p.id) ?? []);
  return linkedIds.filter((id) => ids.has(id));
}
