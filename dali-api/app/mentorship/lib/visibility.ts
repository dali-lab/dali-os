import { isCore, isLabMentor } from "~/lib/roles";
import { prisma } from "~/lib/db";

// Area gate for `/mentorship` surfaces. Mentees are excluded: only active lab
// mentors and Core/Admin may enter. Per-note / per-pair read scope is narrower
// — see `canViewMentorNote`, `mentorNoteWhere`, and `mentorshipPairWhere`.
export async function canViewMentorship(userId: string): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isLabMentor(userId);
}

/** Domains the user mentors in (via MentorshipPair as mentor). */
export async function getMentorDomainIds(userId: string): Promise<string[]> {
  const pairs = await prisma.mentorshipPair.findMany({
    where: { mentorUserId: userId },
    select: { domainId: true },
    distinct: ["domainId"],
  });
  return pairs.map((p) => p.domainId);
}

/**
 * MentorNote list/filter scope. Core/Admin: unrestricted. Mentors: notes they
 * authored, plus notes in domains they mentor in.
 */
export async function mentorNoteWhere(
  userId: string,
): Promise<Record<string, unknown>> {
  if (await isCore(userId)) return {};
  const domainIds = await getMentorDomainIds(userId);
  const clauses: Record<string, unknown>[] = [{ mentorId: userId }];
  if (domainIds.length > 0) {
    clauses.push({ domainId: { in: domainIds } });
  }
  return { OR: clauses };
}

/**
 * MentorshipPair list/filter scope. Core/Admin: unrestricted. Mentors: their
 * own pairs, plus pairs in domains they mentor in.
 */
export async function mentorshipPairWhere(
  userId: string,
): Promise<Record<string, unknown>> {
  if (await isCore(userId)) return {};
  const domainIds = await getMentorDomainIds(userId);
  const clauses: Record<string, unknown>[] = [{ mentorUserId: userId }];
  if (domainIds.length > 0) {
    clauses.push({ domainId: { in: domainIds } });
  }
  return { OR: clauses };
}

/** Single-note read check. Author or same-domain mentor, or Core/Admin. */
export async function canViewMentorNote(
  userId: string,
  note: { mentorId: string; domainId: string },
): Promise<boolean> {
  if (await isCore(userId)) return true;
  if (note.mentorId === userId) return true;
  if (!(await isLabMentor(userId))) return false;
  const domainIds = await getMentorDomainIds(userId);
  return domainIds.includes(note.domainId);
}
