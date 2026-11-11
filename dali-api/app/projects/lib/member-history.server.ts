import { prisma } from "~/lib/db.server";
import type { MemberHistory } from "./member-history";

const TERM_SELECT = { select: { code: true, sortKey: true, startDate: true } } as const;

export async function loadMemberHistories(userIds: string[]): Promise<Map<string, MemberHistory>> {
  const byUser = new Map<string, MemberHistory>(
    userIds.map((id) => [id, { projects: [], core: [] }]),
  );
  if (userIds.length === 0) return byUser;
  const [projects, core] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        level: true,
        domainId: true,
        project: { select: { name: true } },
        domain: { select: { displayName: true } },
        term: TERM_SELECT,
      },
    }),
    prisma.coreAssignment.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, leadTitle: true, term: TERM_SELECT },
    }),
  ]);
  for (const a of projects) byUser.get(a.userId)?.projects.push(a);
  for (const c of core) byUser.get(c.userId)?.core.push(c);
  return byUser;
}
