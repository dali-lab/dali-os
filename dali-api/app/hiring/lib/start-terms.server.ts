// DB side of start terms: load the Term rows the pure helpers in
// start-terms.ts operate on, and apply the writes that have to stay floored at
// the cycle's own term.

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import {
  effectiveStartTermId,
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

/** The code of the term `effectiveStartTermId` picks, or null when it picks none. */
export async function startTermCodeFor(
  application: { startTermId: string | null; startTerm: { code: string } | null },
  cycle: { termId: string | null; startTermIds: string[]; term: { code: string } | null },
): Promise<string | null> {
  const id = effectiveStartTermId(application, cycle);
  if (!id) return null;
  if (id === application.startTermId && application.startTerm) return application.startTerm.code;
  if (id === cycle.termId && cycle.term) return cycle.term.code;
  const term = await prisma.term.findUnique({ where: { id }, select: { code: true } });
  return term?.code ?? null;
}

/**
 * Clear applicant picks the cycle no longer offers. Hires are left alone: once
 * an acceptance is released, their start term is an onboarding decision that
 * may deliberately name a term the cycle never offered.
 */
async function clearUnofferedPicks(cycleId: string, kept: string[]): Promise<number> {
  const { count } = await prisma.application.updateMany({
    where: {
      applicationCycleId: cycleId,
      startTermId: { not: null },
      ...(kept.length > 0 ? { NOT: { startTermId: { in: kept } } } : {}),
      domainApplications: {
        none: { decisions: { some: { type: "Accepted", stage: "Released" } } },
      },
    },
    data: { startTermId: null },
  });
  return count;
}

/**
 * Save a cycle's offered start terms, floored at its own term, and clear the
 * picks the new set no longer offers. Returns the ids actually stored.
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
  await clearUnofferedPicks(cycleId, kept);
  return kept;
}

/**
 * Re-floor a cycle's start terms after its own term changed, and clear any
 * applicant pick the move invalidated. Moving a cycle's term LATER can strip
 * options that were valid when the lead chose them.
 *
 * Returns what it dropped so the caller can say so instead of silently
 * discarding a lead's configuration.
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

  const clearedPicks = await clearUnofferedPicks(cycleId, kept);
  return { droppedOptions, clearedPicks };
}

export type SetStartTermResult =
  | { ok: true; startTermId: string | null }
  | { ok: false; status: 400 | 404; error: string };

/**
 * A lead sets (or clears, with an empty termId) one applicant's start term.
 * Not limited to the offered set, so a deferral can name any term, but never
 * one before the term the cycle ran in.
 */
export async function setApplicationStartTerm(args: {
  userId: string;
  cycleId: string;
  termId: string;
  actorId: string;
  request: Request;
}): Promise<SetStartTermResult> {
  const { userId, cycleId, termId, actorId, request } = args;
  const application = await prisma.application.findUnique({
    where: { userId_applicationCycleId: { userId, applicationCycleId: cycleId } },
    select: { id: true, applicationCycle: { select: { term: { select: { sortKey: true } } } } },
  });
  if (!application) return { ok: false, status: 404, error: "No application for that cycle" };

  let startTermId: string | null = null;
  if (termId !== "") {
    const term = await prisma.term.findUnique({ where: { id: termId }, select: { sortKey: true } });
    if (!term) return { ok: false, status: 400, error: "Unknown term" };
    const floor = application.applicationCycle.term?.sortKey ?? null;
    if (floor != null && term.sortKey < floor) {
      return { ok: false, status: 400, error: "A start term can't be before the term the cycle ran in." };
    }
    startTermId = termId;
  }

  await prisma.application.update({
    where: { id: application.id },
    data: { startTermId },
  });
  await logAuditEvent({
    action: "application.start-term",
    userId: actorId,
    targetId: application.id,
    metadata: { cycleId, applicantUserId: userId, startTermId },
    request,
  });
  return { ok: true, startTermId };
}
