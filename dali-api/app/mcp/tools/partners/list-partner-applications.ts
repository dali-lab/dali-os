// MCP tool: list_partner_applications — list partner applications with optional status filter.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import {
  PARTNER_APPLICATION_STATUSES,
  isPartnerApplicationStatus,
  type PartnerApplicationStatus,
} from "~/partners/lib/partner-application";
import { McpForbiddenError, McpInvalidError } from "../../registry";

export const LIST_PARTNER_APPLICATIONS_TOOL = {
  name: "list_partner_applications",
  description:
    "List partner applications, optionally filtered by status. Valid statuses: Submitted, UnderReview, OnHold, Accepted, Rejected. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "array",
        items: {
          type: "string",
          enum: PARTNER_APPLICATION_STATUSES as unknown as string[],
        },
        description: "Filter to one or more statuses. Omit to return all.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerApplications(
  callerId: string,
  input: { status?: string[] },
): Promise<{ applications: unknown[] }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner applications");
  }

  const validStatuses: PartnerApplicationStatus[] = [];
  if (input.status && input.status.length > 0) {
    for (const s of input.status) {
      if (!isPartnerApplicationStatus(s)) {
        throw new McpInvalidError(
          `Invalid status '${s}'. Valid values: ${PARTNER_APPLICATION_STATUSES.join(", ")}`,
        );
      }
      validStatuses.push(s);
    }
  }

  const applications = await prisma.partnerApplication.findMany({
    where: validStatuses.length > 0 ? { status: { in: validStatuses } } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      partnerOrg: { select: { id: true, name: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { term: { select: { code: true } } },
      },
      domains: {
        select: {
          domainId: true,
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
    },
  });

  return {
    applications: applications.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      partnerOrgId: a.partnerOrg.id,
      partnerOrgName: a.partnerOrg.name,
      targetTerms: a.targetTerms.map((t) => t.term.code),
      domains: a.domains.map((d) => ({
        domainId: d.domainId,
        domainName: d.domain.displayName,
        expectedMembers: d.expectedMembers,
      })),
      totalExpectedMembers: a.domains.reduce((sum, d) => sum + d.expectedMembers, 0),
      createdAt: a.createdAt,
    })),
  };
}
