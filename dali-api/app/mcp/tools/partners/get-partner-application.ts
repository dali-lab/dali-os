// MCP tool: get_partner_application — get full details of one partner application.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const GET_PARTNER_APPLICATION_TOOL = {
  name: "get_partner_application",
  description:
    "Get full details for a partner application, including partner org, target terms, domain scope, and whether a form submission is attached. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: { type: "string", description: "PartnerApplication id." },
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetPartnerApplication(
  callerId: string,
  input: { applicationId: string },
): Promise<unknown> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner applications");
  }

  const application = await prisma.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      title: true,
      status: true,
      summary: true,
      sowDocId: true,
      resultingProjectId: true,
      partnerOrg: { select: { id: true, name: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true, term: { select: { code: true } } },
      },
      domains: {
        orderBy: { domain: { displayName: "asc" } },
        select: {
          id: true,
          domainId: true,
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
      formSubmission: { select: { id: true } },
    },
  });

  if (!application) {
    throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);
  }

  return {
    id: application.id,
    title: application.title,
    status: application.status,
    summary: application.summary,
    sowDocId: application.sowDocId,
    resultingProjectId: application.resultingProjectId,
    partner: {
      id: application.partnerOrg.id,
      name: application.partnerOrg.name,
    },
    targetTerms: application.targetTerms.map((t) => ({
      termId: t.termId,
      code: t.term.code,
    })),
    domains: application.domains.map((d) => ({
      id: d.id,
      domainId: d.domainId,
      domainName: d.domain.displayName,
      expectedMembers: d.expectedMembers,
    })),
    hasFormSubmission: application.formSubmission !== null,
  };
}
