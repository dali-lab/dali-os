// MCP `list_members` — directory browse. Returns the current-term-active member
// list (same default as the web People page) with optional filters. No query
// required — callers can list everyone. Reuses the same Prisma select + tier
// derivation as `search_directory`, but without the required query param and
// with additional optional filters. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { currentTerm, currentTermMemberWhere, isAdminViaEnv } from "~/lib/roles";
import { offsetPage, offsetWindow, pageArray, pageProps, type PageArgs } from "~/mcp/pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 100 };

export const LIST_MEMBERS_DEF = {
  name: "list_members",
  description:
    "Browse the DALI member directory. Returns current-term-active members by default. " +
    "Optionally filter by domain name/code, tier, or a name/email substring. " +
    "Use `includeInactive` to also include alumni and members inactive this term. " +
    "Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the full match count.",
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
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & {
  q?: string;
  domain?: string;
  tier?: "admin" | "core" | "domain-lead" | "member";
  includeInactive?: boolean;
};

export async function runListMembers(input: Input) {
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

  const where = { AND: andFilters };
  const orderBy = [{ lastName: "asc" as const }, { firstName: "asc" as const }, { id: "asc" as const }];
  const select = {
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
  };

  type UserRow = {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
    adminMembership: { id: string } | null;
    coreAssignments: { leadTitle: string | null }[];
    domainLeadAssignmentsAsUser: { domain: { displayName: string } }[];
    domainEligibilities: { domain: { displayName: string } }[];
  };

  type MemberRow = {
    id: string;
    firstName: string;
    lastName: string;
    daliEmail: string | null;
    tier: "admin" | "core" | "domain-lead" | "member";
    domains: string[];
    currentTermRoles: string[];
  };

  const toRow = (u: UserRow): MemberRow => {
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
  };

  if (input.tier) {
    const users = await prisma.user.findMany({ where, orderBy, select });
    const matching = users.map(toRow).filter((m) => m.tier === input.tier);
    const { rows, page } = pageArray(matching, input, PAGE_LIMITS);
    return { members: rows, page };
  }

  const window = offsetWindow(input, PAGE_LIMITS);
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy, select, skip: window.skip, take: window.take }),
    prisma.user.count({ where }),
  ]);
  const { rows, page } = offsetPage(users.map(toRow), window, total);
  return { members: rows, page };
}
