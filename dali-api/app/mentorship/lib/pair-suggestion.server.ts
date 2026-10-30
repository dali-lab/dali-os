import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { currentTerm } from "~/lib/roles";
import type { MentorPairOption } from "~/calendar/lib/types";
import type { PairKey } from "./pair-notebook.server";

const pairOrder = [{ projectId: "asc" as const }, { domainId: "asc" as const }];

/** The viewer's mentees this term, one entry each. Only the mentor can edit a pair's notebook, so only the mentor gets a suggestion. */
export async function listMentorPairs(mentorId: string, request?: Request): Promise<MentorPairOption[]> {
  const term = await currentTerm(request);
  if (!term) return [];
  const rows = await prisma.mentorshipPair.findMany({
    where: { mentorUserId: mentorId, termId: term.id },
    orderBy: pairOrder,
    select: { menteeUserId: true, mentee: { select: { firstName: true, lastName: true } } },
  });
  const byMentee = new Map<string, MentorPairOption>();
  for (const r of rows) {
    if (!byMentee.has(r.menteeUserId)) {
      byMentee.set(r.menteeUserId, { menteeId: r.menteeUserId, menteeName: fullName(r.mentee) });
    }
  }
  return [...byMentee.values()];
}

/** The pair this mentor has with this mentee in the current term; the first by project and domain when they share several. */
export async function findMentorPair(
  mentorId: string,
  menteeId: string,
  request?: Request,
): Promise<PairKey | null> {
  const term = await currentTerm(request);
  if (!term) return null;
  const pair = await prisma.mentorshipPair.findFirst({
    where: { mentorUserId: mentorId, menteeUserId: menteeId, termId: term.id },
    orderBy: pairOrder,
    select: { mentorUserId: true, menteeUserId: true, projectId: true, termId: true, domainId: true },
  });
  return pair
    ? { mentorId: pair.mentorUserId, menteeId: pair.menteeUserId, projectId: pair.projectId, termId: pair.termId, domainId: pair.domainId }
    : null;
}
