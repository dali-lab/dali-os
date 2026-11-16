import { prisma } from "~/lib/db.server";
import { userTextWhere } from "~/lib/person-search";
import { currentTerm, currentTermMemberWhere, isAdminViaEnv } from "~/lib/roles";

export type DirectoryRow = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  tier: "admin" | "core" | "domain-lead" | "member";
  domains: string[];
  currentTermRoles: string[];
};

export async function searchDirectory({
  query,
  skip = 0,
  take,
  includeInactive = false,
}: {
  query: string;
  skip?: number;
  take: number;
  includeInactive?: boolean;
}): Promise<DirectoryRow[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const term = await currentTerm();
  const termId = term?.id ?? null;

  const memberWhere = includeInactive
    ? { daliMember: { isNot: null } }
    : await currentTermMemberWhere();

  const users = await prisma.user.findMany({
    where: {
      AND: [
        memberWhere,
        userTextWhere(q, ["firstName", "lastName", "daliEmail", "netId"], (word) => [
          {
            domainEligibilities: {
              some: {
                domain: {
                  OR: [
                    { displayName: { contains: word, mode: "insensitive" } },
                    { code: { contains: word, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
          { coreAssignments: { some: { leadTitle: { contains: word, mode: "insensitive" } } } },
        ]),
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    skip,
    take,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      adminMembership: { select: { id: true } },
      coreAssignments: termId
        ? { where: { termId }, select: { leadTitle: true } }
        : { select: { leadTitle: true } },
      domainLeadAssignmentsAsUser: termId
        ? {
            where: { termId },
            select: { domain: { select: { displayName: true } } },
          }
        : { select: { domain: { select: { displayName: true } } } },
      domainEligibilities: {
        select: { domain: { select: { displayName: true } } },
      },
    },
  });

  return users.map((u) => {
    const isAdminUser = u.adminMembership !== null || isAdminViaEnv(u.id);
    const isCoreUser = isAdminUser || u.coreAssignments.length > 0;
    const isDomainLeadUser = u.domainLeadAssignmentsAsUser.length > 0;
    const tier: DirectoryRow["tier"] = isAdminUser
      ? "admin"
      : isCoreUser
        ? "core"
        : isDomainLeadUser
          ? "domain-lead"
          : "member";

    const currentTermRoles: string[] = [];
    for (const c of u.coreAssignments) {
      if (c.leadTitle) currentTermRoles.push(c.leadTitle);
    }
    for (const dl of u.domainLeadAssignmentsAsUser) {
      currentTermRoles.push(`${dl.domain.displayName} Lead`);
    }

    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      daliEmail: u.daliEmail,
      tier,
      domains: u.domainEligibilities.map((e) => e.domain.displayName),
      currentTermRoles,
    };
  });
}
