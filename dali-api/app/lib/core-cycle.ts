import { prisma } from "~/lib/db";

// Core is elected in Spring (election cycle) and the lab's Core cohort stays
// the same through the following Winter. We materialize one CoreAssignment row
// per term in that window so every reader can just query by termId without
// re-deriving cycle math.
//
// Cycle math (mirrors lib/roles.ts):
//   Season digits — W=1, S=2, X=3, F=4. Cycle starts at the Spring of the
//   given term's cycle and spans [Spring N, Spring N+1) in sortKey space,
//   i.e. 10 consecutive sortKeys → 4 terms (S, X, F, W).
//
// This helper is intentionally parameterizable (any term, not just current)
// so add/remove writers can fan out across the cycle of whichever term they
// were handed.

function cycleStartSortKey(sk: number): number {
  const seasonDigit = sk % 10;
  return seasonDigit === 1 ? sk - 9 : sk - seasonDigit + 2;
}

export function cycleSortKeyRange(termSortKey: number): { gte: number; lt: number } {
  const start = cycleStartSortKey(termSortKey);
  return { gte: start, lt: start + 10 };
}

export async function coreCycleTermIds(termId: string): Promise<string[]> {
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { sortKey: true },
  });
  if (!term) return [];
  const range = cycleSortKeyRange(term.sortKey);
  const terms = await prisma.term.findMany({
    where: { sortKey: { gte: range.gte, lt: range.lt } },
    select: { id: true },
  });
  return terms.map((t) => t.id);
}
