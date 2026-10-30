// MCP tool: list_partner_activity — the full activity timeline of one partner
// organization. Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { McpForbiddenError, McpNotFoundError } from "../../registry";
import { keysetPage, keysetWindow, pageProps, type PageArgs, type PageInfo } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_PARTNER_ACTIVITY_TOOL = {
  name: "list_partner_activity",
  description:
    "List a partner organization's activity timeline, newest first. get_partner_org returns only the 20 most recent rows. Pass page.nextCursor as cursor to read the next page until page.hasMore is false; page.total is the number of rows. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      orgId: { type: "string", description: "PartnerOrg id." },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["orgId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerActivity(
  callerId: string,
  input: PageArgs & { orgId: string },
): Promise<{ page: PageInfo; activity: unknown[] }> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner organizations");
  }

  const org = await prisma.partnerOrg.findUnique({ where: { id: input.orgId }, select: { id: true } });
  if (!org) throw new McpNotFoundError(`Partner organization ${input.orgId} not found`);

  const where = { orgId: org.id };
  const window = keysetWindow(input, PAGE_LIMITS, [{ field: "createdAt", direction: "desc", type: "date" }]);
  const [fetched, total] = await Promise.all([
    prisma.partnerActivity.findMany({
      where: { AND: [where, window.where] },
      orderBy: window.orderBy,
      take: window.take,
      select: { id: true, createdAt: true, type: true, body: true, metadata: true },
    }),
    prisma.partnerActivity.count({ where }),
  ]);
  const { rows, page } = keysetPage(fetched, window, total);

  return { page, activity: rows };
}
