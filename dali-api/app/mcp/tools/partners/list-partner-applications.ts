// MCP tool: list_partner_applications — list partner applications with optional stage filter.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import {
  PARTNER_STAGES,
  isPartnerStage,
  isStale,
  type PartnerStage,
} from "~/partners/lib/partner-application";
import { McpForbiddenError, McpInvalidError } from "../../registry";

const DEFAULT_STALE_DAYS = 14;

export const LIST_PARTNER_APPLICATIONS_TOOL = {
  name: "list_partner_applications",
  description:
    "List partner applications, optionally filtered by stage. Valid stages: New, Interview, Accepted, Rejected. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stage: {
        type: "array",
        items: {
          type: "string",
          enum: PARTNER_STAGES as unknown as string[],
        },
        description: "Filter to one or more stages. Omit to return all.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerApplications(
  callerId: string,
  input: { stage?: string[] },
): Promise<{ applications: unknown[] }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner applications");
  }

  const validStages: PartnerStage[] = [];
  if (input.stage && input.stage.length > 0) {
    for (const s of input.stage) {
      if (!isPartnerStage(s)) {
        throw new McpInvalidError(
          `Invalid stage '${s}'. Valid values: ${PARTNER_STAGES.join(", ")}`,
        );
      }
      validStages.push(s);
    }
  }

  const [applications, settings] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: validStages.length > 0 ? { stage: { in: validStages } } : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        stage: true,
        createdAt: true,
        nextStep: true,
        nextStepDueAt: true,
        lastActivityAt: true,
        holdUntil: true,
        partnerOrg: { select: { id: true, name: true } },
        applicantContact: { select: { id: true, name: true, email: true } },
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
    }),
    prisma.partnerCrmSettings.findUnique({ where: { id: "default" }, select: { staleDays: true } }),
  ]);
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;

  return {
    applications: applications.map((a) => ({
      id: a.id,
      title: a.title,
      stage: a.stage,
      partnerOrgId: a.partnerOrg?.id ?? null,
      partnerOrgName: a.partnerOrg?.name ?? null,
      applicantContact: a.applicantContact
        ? { id: a.applicantContact.id, name: a.applicantContact.name, email: a.applicantContact.email }
        : null,
      targetTerms: a.targetTerms.map((t) => t.term.code),
      domains: a.domains.map((d) => ({
        domainId: d.domainId,
        domainName: d.domain.displayName,
        expectedMembers: d.expectedMembers,
      })),
      totalExpectedMembers: a.domains.reduce((sum, d) => sum + d.expectedMembers, 0),
      createdAt: a.createdAt,
      nextStep: a.nextStep,
      nextStepDueAt: a.nextStepDueAt,
      lastActivityAt: a.lastActivityAt,
      isStale: isStale(a, staleDays),
    })),
  };
}
