// MCP `list_domains` — returns every lab domain with its lead assignments and
// activity counts. Mirrors the api.domains.ts loader gate: isCore, isDomainLead,
// or isAdmin (any one suffices). Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";
import { isCore, isDomainLead, isAdmin } from "~/lib/roles";
import { AdminForbiddenError as McpForbiddenError } from "./errors";

export const LIST_DOMAINS_TOOL = {
  name: "list_domains",
  description:
    "List all lab domains with their lead assignments and activity counts (challenge versions, application cycles, reviewers, interviewers, deliberation sessions). Accessible to Core leads, domain leads, and admins.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListDomains(callerId: string) {
  const [hl, dl, admin] = await Promise.all([
    isCore(callerId),
    isDomainLead(callerId),
    isAdmin(callerId),
  ]);
  if (!hl && !dl && !admin) {
    throw new McpForbiddenError("Only Core leads, domain leads, or admins can list domains.");
  }

  const domains = await prisma.domain.findMany({
    orderBy: { displayName: "asc" },
    include: {
      domainLeadAssignments: {
        include: { user: true },
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

  return { domains };
}
