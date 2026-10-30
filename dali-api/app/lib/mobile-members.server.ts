import { prisma } from "~/lib/db.server";
import { currentTerm, isAdminViaEnv } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { derivePresenceState } from "~/lib/presence";
import { ACTIVE_LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import {
  displayName,
  memberRoles,
  memberTerm,
  memberTitle,
  mobilePresence,
  type MemberSummary,
  type MemberTermFacts,
} from "~/lib/mobile-format";

export type { MemberSummary } from "~/lib/mobile-format";

function summarySelect(termId: string | null) {
  const inTerm = termId ? { where: { termId } } : { take: 0 };
  return {
    id: true,
    firstName: true,
    lastName: true,
    handle: true,
    photoUrl: true,
    lastActiveAt: true,
    hideActivity: true,
    presenceAway: true,
    adminMembership: { select: { isStaff: true } },
    coreAssignments: { ...inTerm, select: { leadTitle: true } },
    domainLeadAssignmentsAsUser: { ...inTerm, select: { domain: { select: { displayName: true } } } },
    projectAssignments: {
      ...inTerm,
      orderBy: { createdAt: "asc" as const },
      select: { domain: { select: { displayName: true } } },
    },
  };
}

type SummaryRow = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(where: object, termId: string | null) {
  return prisma.user.findMany({
    where,
    orderBy: MEMBER_LIST_ORDER_BY,
    select: summarySelect(termId),
  });
}

export function termFactsFor(row: SummaryRow, currentTermCode: string | null): MemberTermFacts {
  const isAdmin = row.adminMembership !== null || isAdminViaEnv(row.id);
  return {
    isStaff: row.adminMembership?.isStaff ?? false,
    isCore: isAdmin || row.coreAssignments.length > 0,
    coreLeadTitle: row.coreAssignments.find((c) => c.leadTitle)?.leadTitle ?? null,
    domainLeadOf: row.domainLeadAssignmentsAsUser.map((d) => d.domain.displayName),
    projectDomains: [...new Set(row.projectAssignments.map((a) => a.domain.displayName))],
    currentTermCode,
    activeThisTerm: row.projectAssignments.length > 0 || row.coreAssignments.length > 0,
  };
}

async function toSummary(row: SummaryRow, currentTermCode: string | null, now: Date): Promise<MemberSummary> {
  const facts = termFactsFor(row, currentTermCode);
  return {
    id: row.id,
    name: displayName(row.firstName, row.lastName),
    handle: row.handle,
    photoUrl: await resolvePhotoUrl(row.photoUrl),
    presence: mobilePresence(derivePresenceState(row.lastActiveAt, now, row.hideActivity), row.presenceAway),
    title: memberTitle(facts),
    term: memberTerm(facts),
    roles: memberRoles(facts),
  };
}

// Without ids: the active lab directory. With ids: exactly those users, in
// directory order, including alumni (a past project's tasks can name them).
export async function listMemberSummaries(userIds?: string[]): Promise<MemberSummary[]> {
  if (userIds && userIds.length === 0) return [];
  const term = await currentTerm();
  const where = userIds ? { id: { in: [...new Set(userIds)] } } : ACTIVE_LAB_MEMBER_WHERE;
  const rows = await loadRows(where, term?.id ?? null);
  const now = new Date();
  return Promise.all(rows.map((r) => toSummary(r, term?.code ?? null, now)));
}

export async function memberSummaryFor(userId: string): Promise<MemberSummary | null> {
  const [summary] = await listMemberSummaries([userId]);
  return summary ?? null;
}

export async function termFactsForUser(userId: string, currentTermCode: string | null): Promise<MemberTermFacts | null> {
  const term = await currentTerm();
  const [row] = await loadRows({ id: userId }, term?.id ?? null);
  return row ? termFactsFor(row, currentTermCode ?? term?.code ?? null) : null;
}
