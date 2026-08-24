// Staffing-derived signing audiences. The new-member and returning-member
// agreements partition the term's *staffed roster* — everyone with a
// ProjectAssignment or CoreAssignment in the term. "New" = in the incoming hire
// cohort (accepted in the latest General/Fellowship cycle — see
// getNewMemberCohortIds); everyone else staffed is "returning". Their union is
// the whole roster and the two never overlap (returning = staffed minus new).
// The mentor agreement's audience is the people actually mentoring the term: P3
// project mentors plus external mentors. All of these exclude full-time staff,
// who are exempt from signing (see getSignerCohorts).
//
// Keying "new" off the hire cohort — not off "never staffed before" — is
// deliberate: Fellowship hires were staffed as interns (so a prior-staffing test
// wrongly calls them returning), and pre-DALIOS members have no assignment
// history at all (so a prior-staffing test wrongly calls them new). The accept
// cohort is the correct signal for both.
//
// The bulk fns feed the admin roster, proactive notifications, and the issuance
// job; the single-user gates feed the live app-gate. Keep the two paths in sync.

import { prisma } from "~/lib/db";
import { getNewMemberCohortIds } from "~/hiring/lib/new-member-cohort.server";
import type { AudiencePerson } from "./audiences";

// Hydrate userIds into AudiencePerson rows, dropping full-time staff.
async function hydrate(userIds: Set<string>): Promise<AudiencePerson[]> {
  if (userIds.size === 0) return [];
  return prisma.user.findMany({
    where: {
      id: { in: [...userIds] },
      NOT: { adminMembership: { is: { isStaff: true } } },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// userIds staffed in the term: any ProjectAssignment or CoreAssignment.
async function staffedUserIds(termId: string): Promise<Set<string>> {
  const [proj, core] = await Promise.all([
    prisma.projectAssignment.findMany({ where: { termId }, select: { userId: true } }),
    prisma.coreAssignment.findMany({ where: { termId }, select: { userId: true } }),
  ]);
  const set = new Set<string>();
  for (const r of proj) set.add(r.userId);
  for (const r of core) set.add(r.userId);
  return set;
}

// The staffed roster split into the incoming hire cohort ("new") and everyone
// else ("returning"). new ∪ returning = the roster; the two are disjoint.
export async function partitionStaffedMembers(
  termId: string,
): Promise<{ newMembers: AudiencePerson[]; returning: AudiencePerson[] }> {
  const staffed = await staffedUserIds(termId);
  if (staffed.size === 0) return { newMembers: [], returning: [] };

  const cohort = await getNewMemberCohortIds();
  const newIds = new Set<string>();
  const returningIds = new Set<string>();
  for (const id of staffed) (cohort.has(id) ? newIds : returningIds).add(id);

  const [newMembers, returning] = await Promise.all([hydrate(newIds), hydrate(returningIds)]);
  return { newMembers, returning };
}

// People mentoring the term: P3 project assignments ∪ external mentors.
export async function listStaffedMentors(termId: string): Promise<AudiencePerson[]> {
  const [p3, external] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { termId, level: "P3" },
      select: { userId: true },
    }),
    prisma.externalMentor.findMany({
      where: { staffingCycle: { termId } },
      select: { userId: true },
    }),
  ]);
  const set = new Set<string>();
  for (const r of p3) set.add(r.userId);
  for (const r of external) set.add(r.userId);
  return hydrate(set);
}

// ── Single-user gates (live app-gate). Keep in sync with the bulk fns above. ──

// Staffed this term = a ProjectAssignment or CoreAssignment in the term.
export async function isStaffedInTerm(userId: string, termId: string): Promise<boolean> {
  const hit = await prisma.user.findFirst({
    where: {
      id: userId,
      OR: [
        { projectAssignments: { some: { termId } } },
        { coreAssignments: { some: { termId } } },
      ],
    },
    select: { id: true },
  });
  return hit !== null;
}

// Mentoring this term = a P3 project assignment or an external-mentor row.
export async function isStaffedMentorInTerm(userId: string, termId: string): Promise<boolean> {
  const [p3, external] = await Promise.all([
    prisma.projectAssignment.findFirst({
      where: { userId, termId, level: "P3" },
      select: { id: true },
    }),
    prisma.externalMentor.findFirst({
      where: { userId, staffingCycle: { termId } },
      select: { id: true },
    }),
  ]);
  return p3 !== null || external !== null;
}
