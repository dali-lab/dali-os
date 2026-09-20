import { prisma } from "~/lib/db";
import {
  blockLabel,
  hasInterviews,
  parseTimeline,
  validateTimeline,
  type DelibBlock,
  type Timeline,
} from "./cycle-timeline";

// The one writer of a cycle's timeline. It keeps `hasInterviews` in step with
// whether the timeline has an Interviews phase, and won't drop a delib round
// whose board has already been opened.

export async function loadCycleTimeline(cycleId: string): Promise<Timeline> {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: { timeline: true },
  });
  return parseTimeline(cycle.timeline);
}

/** Round ids that already have a delibs board (in any domain). */
export async function roundsWithBoards(cycleId: string): Promise<Set<string>> {
  const sessions = await prisma.delibsSession.findMany({
    where: { applicationCycleId: cycleId },
    select: { roundId: true },
    distinct: ["roundId"],
  });
  return new Set(sessions.map((s) => s.roundId));
}

/** Save a timeline, or say why it can't be. */
export async function saveCycleTimeline(cycleId: string, next: Timeline): Promise<string | null> {
  const invalid = validateTimeline(next);
  if (invalid) return invalid;
  const [current, withBoards] = await Promise.all([loadCycleTimeline(cycleId), roundsWithBoards(cycleId)]);
  const kept = new Set(next.filter((b): b is DelibBlock => b.kind === "delib").map((b) => b.id));
  const dropped = current.find((b): b is DelibBlock => b.kind === "delib" && withBoards.has(b.id) && !kept.has(b.id));
  if (dropped) return `${blockLabel(dropped)} already has a board, so it can't be removed.`;
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { timeline: next, hasInterviews: hasInterviews(next) },
  });
  return null;
}
