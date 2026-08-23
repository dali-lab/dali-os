// MCP tool: list_partner_orgs — list all partner organizations.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { OPEN_APPLICATION_STATUSES } from "~/partners/lib/partner-application";
import { McpForbiddenError } from "../../registry";

export const LIST_PARTNER_ORGS_TOOL = {
  name: "list_partner_orgs",
  description:
    "List all partner organizations with summary counts (active members, active projects), plus a lab-wide openInquiryCount (open applications are not org-scoped until promotion). Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerOrgs(
  callerId: string,
  _input: Record<string, unknown>,
): Promise<{ orgs: unknown[]; openInquiryCount: number }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner organizations");
  }

  const now = new Date();
  const [orgs, openInquiryCount] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        website: true,
        isIndividual: true,
        // Active members only; account-first `memberships`, not the retired
        // `users`/PartnerUser relation (which no longer gets rows).
        memberships: { where: { endedAt: null }, select: { id: true } },
        projects: {
          select: {
            startedAt: true,
            endedAt: true,
            project: { select: { status: true } },
          },
        },
      },
    }),
    // Open inquiries are org-independent until promotion, so this is a single
    // lab-wide number rather than a (dead) per-org count.
    prisma.partnerApplication.count({
      where: { status: { in: OPEN_APPLICATION_STATUSES } },
    }),
  ]);

  return {
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      website: o.website,
      isIndividual: o.isIndividual,
      memberCount: o.memberships.length,
      activeProjectCount: o.projects.filter(
        (p) =>
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      ).length,
    })),
    openInquiryCount,
  };
}
