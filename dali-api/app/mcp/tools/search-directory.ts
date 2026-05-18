// MCP `search_directory` — substring search over lab members (User rows with a
// linked DALIMember marker). Matches against names, daliEmail, netId, domain
// names, and current-term role titles. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";

export const SEARCH_DIRECTORY_TOOL = {
  name: "search_directory",
  description:
    "Search the DALI member directory. Matches against name fragments, daliEmail, netId, domain names, and role titles. Only returns lab members.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Search query (≤ 100 chars). Case-insensitive substring match.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum results to return (default 20, max 50).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { query: string; limit?: number };

type DirectoryRow = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  netId: string | null;
  tier: "admin" | "core" | "domain-lead" | "member";
  domains: string[];
  currentTermRoles: string[];
};

export async function runSearchDirectory(input: Input): Promise<{ results: DirectoryRow[] }> {
  const q = input.query.trim();
  if (q.length === 0) return { results: [] };
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));

  const term = await currentTerm();
  const termId = term?.id ?? null;

  const users = await prisma.user.findMany({
    where: {
      daliMember: { isNot: null },
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { daliEmail: { contains: q, mode: "insensitive" } },
        { netId: { contains: q, mode: "insensitive" } },
        {
          domainEligibilities: {
            some: {
              domain: {
                OR: [
                  { displayName: { contains: q, mode: "insensitive" } },
                  { code: { contains: q, mode: "insensitive" } },
                ],
              },
            },
          },
        },
        {
          coreAssignments: {
            some: { leadTitle: { contains: q, mode: "insensitive" } },
          },
        },
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      netId: true,
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

  const results: DirectoryRow[] = users.map((u) => {
    const isAdminUser = u.adminMembership !== null;
    const isCoreUser = u.coreAssignments.length > 0;
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
      netId: u.netId,
      tier,
      domains: u.domainEligibilities.map((e) => e.domain.displayName),
      currentTermRoles,
    };
  });

  return { results };
}
