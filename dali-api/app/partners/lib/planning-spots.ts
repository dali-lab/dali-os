import type { Level } from "~/generated/prisma/enums";

export type SpotRow = { id: string; domainId: string; level: Level; slots: number };

export type SpotWrites = {
  deleteIds: string[];
  updates: { id: string; slots: number }[];
  creates: { domainId: string; slots: number }[];
};

const LEVEL_ORDER: Level[] = ["P1", "P2", "P3"];

// Reshape a term's role requests to new per-domain totals while keeping the
// level split and role notes of rows that survive: growth lands on P1, cuts
// come out of P1 first.
export function planSpotWrites(
  existing: SpotRow[],
  target: { domainId: string; slots: number }[],
): SpotWrites {
  const writes: SpotWrites = { deleteIds: [], updates: [], creates: [] };
  const want = new Map(target.map((t) => [t.domainId, t.slots]));
  const byDomain = new Map<string, SpotRow[]>();
  for (const row of existing) {
    byDomain.set(row.domainId, [...(byDomain.get(row.domainId) ?? []), row]);
  }

  for (const [domainId, rows] of byDomain) {
    const goal = want.get(domainId) ?? 0;
    const sorted = [...rows].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
    let delta = goal - sorted.reduce((n, r) => n + r.slots, 0);
    if (delta > 0) {
      const p1 = sorted.find((r) => r.level === "P1");
      if (p1) writes.updates.push({ id: p1.id, slots: p1.slots + delta });
      else writes.creates.push({ domainId, slots: delta });
      continue;
    }
    for (const row of sorted) {
      if (delta >= 0) break;
      const cut = Math.min(row.slots, -delta);
      if (cut === row.slots) writes.deleteIds.push(row.id);
      else writes.updates.push({ id: row.id, slots: row.slots - cut });
      delta += cut;
    }
  }

  for (const [domainId, slots] of want) {
    if (!byDomain.has(domainId) && slots > 0) writes.creates.push({ domainId, slots });
  }
  return writes;
}
