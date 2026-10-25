// The lab's Neon org is shared by every project, so the sweep caches the whole
// org and each project's view keeps only the Neon projects linked to it.

import type { NeonInventory } from "./types";

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

export function isSampleInScope(s: ScopedSample, neonProjectIds: string[]): boolean {
  return s.provider !== "neon" || neonProjectIds.includes(s.scopeId);
}

// One point per (metric, time): a project with several Fly apps or Neon
// databases reports the sum, not whichever sample came last.
export function usageSeries(
  samples: ScopedSample[],
  limit = 40,
): { metric: string; points: { at: string; value: number }[] }[] {
  const byMetric = new Map<string, Map<string, number>>();
  for (const s of [...samples].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const at = s.at.toISOString();
    const points = byMetric.get(s.metric) ?? new Map<string, number>();
    points.set(at, (points.get(at) ?? 0) + s.value);
    byMetric.set(s.metric, points);
  }
  return [...byMetric.entries()].map(([metric, points]) => ({
    metric,
    points: [...points.entries()].map(([at, value]) => ({ at, value })).slice(-limit),
  }));
}
