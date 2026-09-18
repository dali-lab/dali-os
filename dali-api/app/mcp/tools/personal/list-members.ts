// MCP `list_members` — directory browse. Returns the current-term-active member
// list (same default as the web People page) with optional filters. No query
// required — callers can list everyone. Reuses the same Prisma select + tier
// derivation as `search_directory`, but without the required query param and
// with additional optional filters. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm, currentTermMemberWhere, isAdminViaEnv } from "~/lib/roles";

export const LIST_MEMBERS_DEF = {
  name: "list_members",
  description:
    "Browse the DALI member directory. Returns current-term-active members by default. " +
    "Optionally filter by domain name/code, tier, or a name/email substring. " +
    "Use `includeInactive` to also include alumni and members inactive this term.",
  inputSchema: {
    type: "object" as const,
    properties: {
      q: {
        type: "string",
        maxLength: 100,
        description: "Optional substring to match against name or daliEmail (case-insensitive).",
      },
      domain: {
        type: "string",
        description: "Filter to members with a domain eligibility matching this domain name or code.",
      },
      tier: {
        type: "string",
        enum: ["admin", "core", "domain-lead", "member"],
        description: "Filter by role tier.",
      },
      includeInactive: {
        type: "boolean",
        description:
          "If true, also include alumni and members with no current-term assignment. Default false.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Maximum results to return (default 50, max 100).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  q?: string;
  domain?: string;
  tier?: "admin" | "core" | "domain-lead" | "member";
  includeInactive?: boolean;
  limit?: number;
};

export async function runListMembers(input: Input) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const term = await currentTerm();
  const termId = term?.id ?? null;

  const memberWhere = input.includeInactive
    ? { daliMember: { isNot: null } }
    : await currentTermMemberWhere();

  // Build the AND filter chain.
  const andFilters: object[] = [memberWhere];

  if (input.q) {
    const q = input.q.trim();
    if (q.length > 0) {
      andFilters.push({
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { daliEmail: { contains: q, mode: "insensitive" } },
        ],
      });
    }
  }

  if (input.domain) {
    const d = input.domain.trim();
    if (d.length > 0) {
      andFilters.push({
        domainEligibilities: {
          some: {
            domain: {
              OR: [
                { displayName: { contains: d, mode: "insensitive" } },
                { code: { contains: d, mode: "insensitive" } },
              ],
            },
          },
        },
      });
    }
  }

  const users = await prisma.user.findMany({
    where: { AND: andFilters },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: limit,
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

  type MemberRow = {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
    tier: "admin" | "core" | "domain-lead" | "member";
    domains: string[];
    currentTermRoles: string[];
  };

  const results: MemberRow[] = [];

  for (const u of users) {
    const isAdminUser = u.adminMembership !== null || isAdminViaEnv(u.id);
    const isCoreUser = isAdminUser || u.coreAssignments.length > 0;
    const isDomainLeadUser = u.domainLeadAssignmentsAsUser.length > 0;
    const tier: MemberRow["tier"] = isAdminUser
      ? "admin"
      : isCoreUser
        ? "core"
        : isDomainLeadUser
          ? "domain-lead"
          : "member";

    // Apply tier filter here (avoids a costly Prisma filter on computed fields).
    if (input.tier && tier !== input.tier) continue;

    const currentTermRoles: string[] = [];
    for (const c of u.coreAssignments) {
      if (c.leadTitle) currentTermRoles.push(c.leadTitle);
    }
    for (const dl of u.domainLeadAssignmentsAsUser) {
      currentTermRoles.push(`${dl.domain.displayName} Lead`);
    }

    results.push({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      daliEmail: u.daliEmail,
      tier,
      domains: u.domainEligibilities.map((e) => e.domain.displayName),
      currentTermRoles,
    });
  }

  return { members: results, count: results.length };
}
