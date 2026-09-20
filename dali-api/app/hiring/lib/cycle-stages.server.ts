import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import { delibRounds, parseTimeline } from "./cycle-timeline";

// Which of a cycle's domain applications land on a delib round's board, from
// the round's place in the cycle's timeline. The domain-lead board, its counts,
// and the reviewer mirror all read this, so they can't disagree about who
// qualifies.

export type CycleForRounds = { id: string; timeline: unknown };

const REVIEWED_UNDECIDED = {
  reviews: { every: { submittedAt: { not: null } }, some: {} },
  decisions: { none: { stage: { in: ["Final", "Released"] } } },
} satisfies Prisma.DomainApplicationWhereInput;

// Someone invited to interview carries an InvitedToInterview decision, so
// later rounds only rule out people who already have an outcome.
const NO_OUTCOME = {
  decisions: {
    none: { type: { in: ["Accepted", "Waitlisted", "Rejected"] }, stage: { in: ["Final", "Released"] } },
  },
} satisfies Prisma.DomainApplicationWhereInput;

/**
 * Where-fragment for the domain applications in `domainId` that qualify for
 * round `roundId`:
 *   the first round: every review submitted, no final decision yet;
 *   a later round: moved on (Advance / Interview) on the previous round's
 *     closed board, plus a completed interview when Interviews sits between
 *     the two rounds. The board is the record of who moved on; Advance writes
 *     no decision.
 * An unknown round qualifies no one.
 */
export async function delibsQualifier(
  cycle: CycleForRounds,
  roundId: string,
  domainId: string,
): Promise<Prisma.DomainApplicationWhereInput> {
  const rounds = delibRounds(parseTimeline(cycle.timeline));
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return { id: { in: [] } };
  if (round.index === 0) return REVIEWED_UNDECIDED;

  const prev = rounds[round.index - 1];
  const prevBoard = await prisma.delibsSession.findUnique({
    where: {
      domainId_applicationCycleId_roundId: { domainId, applicationCycleId: cycle.id, roundId: prev.id },
    },
    select: { status: true, columnOrder: true },
  });
  const movedOn =
    prevBoard?.status === "Closed" && prev.advanceColumn
      ? ((prevBoard.columnOrder as Record<string, string[]> | null)?.[prev.advanceColumn] ?? [])
      : [];
  return {
    id: { in: movedOn },
    ...NO_OUTCOME,
    ...(round.afterInterviews && { interviews: { some: { status: "Completed" } } }),
  };
}
