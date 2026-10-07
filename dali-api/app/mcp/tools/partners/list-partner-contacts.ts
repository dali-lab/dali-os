// MCP tool: list_partner_contacts — search partner contacts, optionally
// scoped to one organization. Scope: mcp:read. Gated to canViewStaffing
// (Core / Domain Lead), matching list_partner_orgs.

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { McpForbiddenError } from "../../registry";

export const LIST_PARTNER_CONTACTS_TOOL = {
  name: "list_partner_contacts",
  description:
    "List partner contacts, optionally filtered by a case-insensitive text search against name or email, or scoped to one organization's active members. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      search: { type: "string", description: "Case-insensitive match against name or email." },
      orgId: { type: "string", description: "Limit to active members of this PartnerOrg." },
    },
    required: [],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListPartnerContacts(
  callerId: string,
  input: { search?: string; orgId?: string },
): Promise<unknown> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner contacts");
  }

  const search = input.search?.trim();
  const contacts = await prisma.partnerContact.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(input.orgId
        ? { memberships: { some: { orgId: input.orgId, endedAt: null } } }
        : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      title: true,
      phone: true,
      affiliation: true,
      preferredChannel: true,
      memberships: {
        where: { endedAt: null },
        select: { org: { select: { id: true, name: true } } },
      },
      _count: { select: { applications: true } },
    },
  });

  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title,
      phone: c.phone,
      affiliation: c.affiliation,
      preferredChannel: c.preferredChannel,
      orgs: c.memberships.map((m) => m.org),
      applicationCount: c._count.applications,
    })),
  };
}
