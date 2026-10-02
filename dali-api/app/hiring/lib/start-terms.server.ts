// DB side of start terms: load the Term rows the pure helpers in
// start-terms.ts operate on, and apply the writes that have to stay floored at
// the cycle's own term.

import { prisma } from "~/lib/db";
import {
  eligibleStartTerms,
  resolveStartTerms,
  pruneStartTermIds,
  type StartTermOption,
} from "./start-terms";

export * from "./start-terms";

/** Every Term, chronological, in the shape the start-term helpers need. */
export async function loadStartTermCandidates(): Promise<StartTermOption[]> {
  return prisma.term.findMany({
    orderBy: { sortKey: "asc" },
    select: { id: true, code: true, sortKey: true },
  });
}

/**
 * The terms a cycle offers as start terms, hydrated and chronological. Queries
 * only the offered ids rather than the whole calendar — the apply page needs
 * these and nothing else.
 */
export async function loadOfferedStartTerms(
  startTermIds: string[],
): Promise<StartTermOption[]> {
  if (startTermIds.length === 0) return [];
  const terms = await prisma.term.findMany({
    where: { id: { in: startTermIds } },
    select: { id: true, code: true, sortKey: true },
  });
  return resolveStartTerms(terms, startTermIds);
}

/**
 * Save a cycle's offered start terms, floored at its own term. Returns the ids
 * actually stored so a caller can tell the lead when a request was trimmed
 * (a stale form, or terms that fell below the floor since they were chosen).
 */
export async function setCycleStartTerms(
  cycleId: string,
  startTermIds: string[],
): Promise<string[]> {
  const [cycle, terms] = await Promise.all([
    prisma.applicationCycle.findUnique({
      where: { id: cycleId },
      select: { term: { select: { sortKey: true } } },
    }),
    loadStartTermCandidates(),
  ]);
  if (!cycle) return [];
  const kept = pruneStartTermIds(startTermIds, terms, cycle.term?.sortKey ?? null);
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { startTermIds: kept },
  });
  return kept;
}

/**
 * Re-floor a cycle's start terms after its own term changed, and clear any
 * applicant pick the move invalidated. Moving a cycle's term LATER can strip
 * options that were valid when the lead chose them; a cleared pick reads as
 * the cycle's term again rather than pointing at a term before the hiring.
 *
 * Returns what it dropped so the caller can say so instead of silently
 * discarding a lead's configuration. No-op (and no writes) when nothing moved
 * out of range, which is the common case.
 */
export async function reflowStartTermsForTermChange(
  cycleId: string,
): Promise<{ droppedOptions: number; clearedPicks: number }> {
  const [cycle, terms] = await Promise.all([
    prisma.applicationCycle.findUnique({
      where: { id: cycleId },
      select: { startTermIds: true, term: { select: { sortKey: true } } },
    }),
    loadStartTermCandidates(),
  ]);
  if (!cycle) return { droppedOptions: 0, clearedPicks: 0 };

  const kept = pruneStartTermIds(
    cycle.startTermIds,
    terms,
    cycle.term?.sortKey ?? null,
  );
  const droppedOptions = cycle.startTermIds.length - kept.length;
  if (droppedOptions > 0) {
    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { startTermIds: kept },
    });
  }

  // Picks pointing at a term the cycle no longer offers. The two conditions are
  // kept apart on purpose: `not: null` always applies, and the kept set is
  // excluded only when there IS one, so an emptied option set clears every pick
  // rather than leaning on how an empty `notIn` happens to compile.
  const { count: clearedPicks } = await prisma.application.updateMany({
    where: {
      applicationCycleId: cycleId,
      startTermId: { not: null },
      ...(kept.length > 0 ? { NOT: { startTermId: { in: kept } } } : {}),
    },
    data: { startTermId: null },
  });

  return { droppedOptions, clearedPicks };
}
