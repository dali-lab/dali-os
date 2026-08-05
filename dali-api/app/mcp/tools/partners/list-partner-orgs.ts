// MCP tool: list_partner_orgs — list all partner organizations.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { OPEN_APPLICATION_STATUSES } from "~/partners/lib/partner-application";
import { McpForbiddenError } from "../../registry";

export const LIST_PARTNER_ORGS_TOOL = {
  name: "list_partner_orgs",
  description:
    "List all partner organizations. Returns summary counts (members, active projects, open applications). Requires staffing-view access.",
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
): Promise<{ orgs: unknown[] }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner organizations");
  }

  const now = new Date();
  const orgs = await prisma.partnerOrg.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      website: true,
      isIndividual: true,
      _count: { select: { users: true } },
      projects: {
        select: {
          startedAt: true,
          endedAt: true,
          project: { select: { status: true } },
        },
      },
      applications: { select: { status: true } },
    },
  });

  return {
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      website: o.website,
      isIndividual: o.isIndividual,
      memberCount: o._count.users,
      activeProjectCount: o.projects.filter(
        (p) =>
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      ).length,
      openApplicationCount: o.applications.filter((a) =>
        (OPEN_APPLICATION_STATUSES as readonly string[]).includes(a.status),
      ).length,
    })),
  };
}
