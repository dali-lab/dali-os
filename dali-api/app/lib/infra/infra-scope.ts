// Fly and Neon orgs are shared by several projects, so the sweep caches the
// whole org and each project's view keeps only the apps and databases linked
// to it.

import { bucketHours, estimateNeonProjectMonth, monthStart } from "./neon-cost";
import type { FlyInventory, NeonInventory } from "./types";

// Sample scopes the sweep writes. Daily and Fly rows draw the sparklines; the
// monthly rows, or the daily rows when those are missing, give the headline
// and cost estimates.
export const SCOPE = {
  neonDaily: "neon-project",
  neonMonth: "neon-project-month",
  neonBranchMonth: "neon-branch-month",
  flyApp: "fly-app",
  flyDaily: "fly-app-day",
} as const;

export function scopeNeonInventory(
  inv: NeonInventory | null,
  neonProjectIds: string[],
): NeonInventory | null {
  if (!inv) return null;
  const ids = new Set(neonProjectIds);
  return { ...inv, projects: inv.projects.filter((p) => ids.has(p.id)) };
}

export function scopeFlyInventory(inv: FlyInventory | null, flyAppNames: string[]): FlyInventory | null {
  if (!inv) return null;
  const names = new Set(flyAppNames);
  return { ...inv, apps: inv.apps.filter((a) => names.has(a.name)) };
}

export function flyAppOptions(inv: FlyInventory | null): { id: string; name: string }[] {
  return (inv?.apps ?? []).map((a) => ({ id: a.name, name: a.name }));
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

export type ResourceScope = { neonProjectIds: string[]; flyAppNames: string[] };

export function isSampleInScope(s: ScopedSample, scope: ResourceScope): boolean {
  if (s.provider === "neon") return scope.neonProjectIds.includes(neonProjectOf(s));
  if (s.provider === "fly") return scope.flyAppNames.includes(s.scopeId);
  return false;
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
 * Sparkline series for a project's in-scope samples. Neon headlines are month
 * to date; series that are zero throughout are dropped so unused metrics don't
 * crowd the strip.
 */
export function projectUsage(samples: ScopedSample[], now: Date): UsageSeries[] {
  const thisMonth = monthStart(now).getTime();
  const monthToDate = new Map<string, number>();
  for (const { month, metrics } of neonMonthTotals(samples, now)) {
    if (month.getTime() !== thisMonth) continue;
    for (const [metric, value] of Object.entries(metrics)) {
      monthToDate.set(metric, (monthToDate.get(metric) ?? 0) + value);
    }
  }
  return usageSeries(samples.filter((s) => s.scopeType === SCOPE.neonDaily || s.scopeType === SCOPE.flyApp))
    .map((u) => (monthToDate.has(u.metric) ? { ...u, current: monthToDate.get(u.metric)! } : u))
    .filter((u) => (u.current ?? 0) > 0 || u.points.some((p) => p.value > 0));
}

// Neon's monthly read has come back empty for the month in progress, so a
// database's month falls back to the sum of its daily rows when no monthly
// rows exist for it.
function neonMonthTotals(
  samples: ScopedSample[],
  now: Date,
): { month: Date; projectId: string; metrics: Record<string, number> }[] {
  const months = [monthStart(now, -1), monthStart(now)];
  const monthly = new Map<string, Record<string, number>>();
  const daily = new Map<string, Record<string, number>>();
  for (const s of samples) {
    const isMonthly = s.scopeType === SCOPE.neonMonth;
    if (!isMonthly && s.scopeType !== SCOPE.neonDaily) continue;
    const month = isMonthly ? s.at : monthStart(s.at);
    if (!months.some((m) => m.getTime() === month.getTime())) continue;
    const target = isMonthly ? monthly : daily;
    const key = `${month.getTime()}|${s.scopeId}`;
    const metrics = target.get(key) ?? {};
    metrics[s.metric] = (metrics[s.metric] ?? 0) + s.value;
    target.set(key, metrics);
  }
  const out: { month: Date; projectId: string; metrics: Record<string, number> }[] = [];
  for (const key of new Set([...monthly.keys(), ...daily.keys()])) {
    const [t, projectId] = key.split("|");
    out.push({ month: new Date(Number(t)), projectId, metrics: monthly.get(key) ?? daily.get(key)! });
  }
  return out;
}

export const NEON_CHART_METRICS = ["compute_unit_seconds", "public_network_transfer_bytes"] as const;
export type NeonDailyRow = { day: string } & Record<(typeof NEON_CHART_METRICS)[number], number>;

/** Per-day totals of the charted Neon metrics across a project's databases, oldest first. */
export function neonDailyUsage(samples: ScopedSample[]): NeonDailyRow[] {
  const byDay = new Map<string, NeonDailyRow>();
  for (const s of samples) {
    if (s.scopeType !== SCOPE.neonDaily) continue;
    const metric = NEON_CHART_METRICS.find((m) => m === s.metric);
    if (!metric) continue;
    const day = s.at.toISOString().slice(0, 10);
    const row = byDay.get(day) ?? { day, compute_unit_seconds: 0, public_network_transfer_bytes: 0 };
    row[metric] += s.value;
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type FlyDailyRow = {
  day: string;
  app: string;
  requests: number;
  errors_5xx: number;
  p95_ms: number | null;
  memory_peak_bytes: number | null;
};

/** One row per (day, app) from the daily Fly rows, oldest first. */
export function flyDailyUsage(samples: ScopedSample[]): FlyDailyRow[] {
  const rows = new Map<string, FlyDailyRow>();
  for (const s of samples) {
    if (s.scopeType !== SCOPE.flyDaily) continue;
    const day = s.at.toISOString().slice(0, 10);
    const key = `${day}|${s.scopeId}`;
    const row = rows.get(key) ?? { day, app: s.scopeId, requests: 0, errors_5xx: 0, p95_ms: null, memory_peak_bytes: null };
    if (s.metric === "requests" || s.metric === "errors_5xx" || s.metric === "p95_ms" || s.metric === "memory_peak_bytes") {
      row[s.metric] = s.value;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.app.localeCompare(b.app));
}

export type FlyDayTotals = Omit<FlyDailyRow, "app">;

/**
 * Daily totals for one app, or every app when `app` is null: requests, errors
 * and memory add up across apps; response time is the slowest app's.
 */
export function flyDayTotals(rows: FlyDailyRow[], app: string | null): FlyDayTotals[] {
  const byDay = new Map<string, FlyDayTotals>();
  const add = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : a + b);
  for (const r of rows) {
    if (app !== null && r.app !== app) continue;
    const t = byDay.get(r.day) ?? { day: r.day, requests: 0, errors_5xx: 0, p95_ms: null, memory_peak_bytes: null };
    t.requests += r.requests;
    t.errors_5xx += r.errors_5xx;
    t.p95_ms = r.p95_ms == null ? t.p95_ms : Math.max(t.p95_ms ?? 0, r.p95_ms);
    t.memory_peak_bytes = add(t.memory_peak_bytes, r.memory_peak_bytes);
    byDay.set(r.day, t);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
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

/** Estimated dollars for this month and last, or null when the plan has no known rates. */
export function neonCostSummary(
  samples: ScopedSample[],
  plan: string | null | undefined,
  now: Date,
): NeonCostSummary | null {
  if (!plan || estimateNeonProjectMonth({}, plan, 0) === null) return null;
  const current = monthStart(now).getTime();
  let thisMonth = 0;
  let lastMonth: number | null = null;
  const byProject: Record<string, number> = {};
  for (const { month, projectId, metrics } of neonMonthTotals(samples, now)) {
    const total = estimateNeonProjectMonth(metrics, plan, bucketHours(month, now))!.total;
    if (month.getTime() === current) {
      thisMonth += total;
      byProject[projectId] = (byProject[projectId] ?? 0) + total;
    } else {
      lastMonth = (lastMonth ?? 0) + total;
    }
  }
  return { plan, thisMonth, lastMonth, byProject };
}

/**
 * App or database choices for the config editor's org. A linked id missing
 * from the org's latest sweep still shows (by id) so it can be removed.
 */
export type KnownOrg = { orgId: string; resources: { id: string; name: string }[] };

export function orgResourceOptions(
  orgId: string,
  knownOrgs: KnownOrg[],
  linkedIds: string[],
): { value: string; label: string }[] {
  const projects = knownOrgs.find((o) => o.orgId === orgId)?.resources ?? [];
  return [
    ...projects.map((p) => ({ value: p.id, label: p.name })),
    ...linkedIds.filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ value: id, label: id })),
  ];
}

/** Linked ids that still belong to the org after switching it. */
export function keepLinkedInOrg(orgId: string, knownOrgs: KnownOrg[], linkedIds: string[]): string[] {
  const ids = new Set(knownOrgs.find((o) => o.orgId === orgId)?.resources.map((p) => p.id) ?? []);
  return linkedIds.filter((id) => ids.has(id));
}

/**
 * Orgs configured on some project, each with the resources from its newest
 * sweep. `orgOf` / `resourcesOf` read the provider's snapshot payload.
 */
export function knownOrgs<T>(
  orgIds: string[],
  newestFirst: (T | null)[],
  orgOf: (inv: T) => string | undefined,
  resourcesOf: (inv: T) => { id: string; name: string }[],
): KnownOrg[] {
  const latest = new Map<string, T>();
  for (const inv of newestFirst) {
    const org = inv ? orgOf(inv) : undefined;
    if (inv && org && !latest.has(org)) latest.set(org, inv);
  }
  return [...new Set(orgIds)].sort().map((orgId) => {
    const inv = latest.get(orgId);
    return { orgId, resources: inv ? resourcesOf(inv) : [] };
  });
}

/** Resources in each known org that no project has linked. */
export function unlinkedResources(
  orgs: KnownOrg[],
  linked: string[],
): { orgId: string; resources: { id: string; name: string }[] }[] {
  const taken = new Set(linked);
  return orgs
    .map((o) => ({ orgId: o.orgId, resources: o.resources.filter((r) => !taken.has(r.id)) }))
    .filter((o) => o.resources.length > 0);
}
