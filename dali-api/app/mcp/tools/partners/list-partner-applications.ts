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
import { keysetPage, keysetWindow, pageProps, type PageArgs, type PageInfo } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

const DEFAULT_STALE_DAYS = 14;

export const LIST_PARTNER_APPLICATIONS_TOOL = {
  name: "list_partner_applications",
  description:
    "List partner applications, newest first, optionally filtered by stage. Pass page.nextCursor as cursor to read the next page until page.hasMore is false. Valid stages: Backlog, New, Interview, Deciding, Accepted, Rejected. Requires staffing-view access.",
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
      ...pageProps(PAGE_LIMITS),
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerApplications(
  callerId: string,
  input: PageArgs & { stage?: string[] },
): Promise<{ page: PageInfo; applications: unknown[] }> {
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

  const stageWhere = validStages.length > 0 ? { stage: { in: validStages } } : {};
  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "createdAt", direction: "desc", type: "date" }]);
  const [fetched, total, settings] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { AND: [stageWhere, window.where] },
      orderBy: window.orderBy,
      take: window.take,
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
    prisma.partnerApplication.count({ where: stageWhere }),
    prisma.partnerCrmSettings.findUnique({ where: { id: "default" }, select: { staleDays: true } }),
  ]);
  const { rows: applications, page } = keysetPage(fetched, window, total);
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;

  return {
    page,
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
