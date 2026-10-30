// MCP tool: list_partner_orgs — list all partner organizations.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db.server";
import { canViewStaffing } from "~/lib/roles";
import { partnerRelationshipStatus } from "~/partners/lib/partner-org";
import { McpForbiddenError } from "../../registry";
import { offsetPage, offsetWindow, pageProps, type PageArgs, type PageInfo } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_PARTNER_ORGS_TOOL = {
  name: "list_partner_orgs",
  description:
    "List partner organizations, sorted by name, with summary counts (active members, active projects), type, and derived relationship status (Active/Past/Prospect/Dormant), plus a lab-wide openInquiryCount (open applications are not org-scoped until promotion). Pass page.nextCursor as cursor to read the next page until page.hasMore is false. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: { ...pageProps(PAGE_LIMITS) },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerOrgs(
  callerId: string,
  input: PageArgs,
): Promise<{ page: PageInfo; orgs: unknown[]; openInquiryCount: number }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner organizations");
  }

  const now = new Date();
  const window = offsetWindow(input, PAGE_LIMITS);
  const [fetched, total, openInquiryCount] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: window.skip,
      take: window.take,
      select: {
        id: true,
        name: true,
        website: true,
        isIndividual: true,
        type: true,
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
        activities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.partnerOrg.count(),
    // Open inquiries are org-independent until promotion, so this is a single
    // lab-wide number rather than a (dead) per-org count. New = not yet
    // through the interview stage.
    prisma.partnerApplication.count({
      where: { stage: "New" },
    }),
  ]);
  const { rows: orgs, page } = offsetPage(fetched, window, total);

  return {
    page,
    orgs: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      website: o.website,
      isIndividual: o.isIndividual,
      type: o.type,
      status: partnerRelationshipStatus({
        projectLinks: o.projects.map((p) => ({ endedAt: p.endedAt })),
        lastActivityAt: o.activities?.[0]?.createdAt ?? null,
        now,
      }),
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
