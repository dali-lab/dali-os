// MCP `list_domains` — returns every lab domain with its lead assignments and
// activity counts. Mirrors the api.domains.ts loader gate: isCore, isDomainLead,
// or isAdmin (any one suffices). Requires the `mcp:read` scope.

import { prisma } from "~/lib/db.server";
import { isCore, isDomainLead, isAdmin, currentTerm } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";

export const LIST_DOMAINS_TOOL = {
  name: "list_domains",
  description:
    "List all lab domains with their lead assignments and activity counts (application cycles, lead assignments, reviewers, interviewers, deliberation sessions). Lead assignments are for the current term unless termId or allTerms is given; the counts always cover all terms. Accessible to Core leads, domain leads, and admins.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: { type: "string", description: "Show lead assignments for this term instead of the current one." },
      allTerms: { type: "boolean", description: "Show lead assignments from every term. Ignored when termId is set." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListDomains(callerId: string, args: { termId?: string; allTerms?: boolean } = {}) {
  const [hl, dl, admin] = await Promise.all([
    isCore(callerId),
    isDomainLead(callerId),
    isAdmin(callerId),
  ]);
  if (!hl && !dl && !admin) {
    throw new McpForbiddenError("Only Core leads, domain leads, or admins can list domains.");
  }

  const termId = args.termId ?? (args.allTerms ? undefined : (await currentTerm())?.id);

  const domains = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    include: {
      domainLeadAssignments: {
        where: termId ? { termId } : undefined,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          termId: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
        },
      },
      _count: {
        select: {
          applicationCycles: true,
          domainLeadAssignments: true,
          cycleReviewers: true,
          cycleInterviewers: true,
          delibsSessions: true,
        },
      },
    },
  });

  return { termId: termId ?? null, domains };
}
