// MCP tool: get_partner_org — get full details of one partner organization.
// Scope: mcp:read. Gated to canViewStaffing (Core / Domain Lead).

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { listPendingInvites } from "~/partners/lib/invites.server";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const GET_PARTNER_ORG_TOOL = {
  name: "get_partner_org",
  description:
    "Get full details for a partner organization, including members, project links, applications, and pending invites. Requires staffing-view access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      orgId: { type: "string", description: "PartnerOrg id." },
    },
    required: ["orgId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetPartnerOrg(
  callerId: string,
  input: { orgId: string },
): Promise<unknown> {
  if (!(await canViewStaffing(callerId))) {
    throw new McpForbiddenError("Only Core members and domain leads can view partner organizations");
  }

  const now = new Date();
  const org = await prisma.partnerOrg.findUnique({
    where: { id: input.orgId },
    select: {
      id: true,
      name: true,
      website: true,
      logoUrl: true,
      isIndividual: true,
      primaryContactId: true,
      createdAt: true,
      memberships: {
        where: { endedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          contact: {
            select: { id: true, name: true, email: true, userId: true },
          },
        },
      },
      projects: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          project: { select: { id: true, name: true, status: true } },
        },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, status: true, createdAt: true },
      },
    },
  });

  if (!org) throw new McpNotFoundError(`Partner organization ${input.orgId} not found`);

  const pendingInvites = await listPendingInvites(org.id);

  return {
    id: org.id,
    name: org.name,
    website: org.website,
    logoUrl: org.logoUrl,
    isIndividual: org.isIndividual,
    primaryContactId: org.primaryContactId,
    createdAt: org.createdAt,
    users: org.memberships.map((m) => ({
      id: m.id,
      displayRole: m.role,
      userId: m.contact.userId,
      name: m.contact.name,
      email: m.contact.email,
      isPrimaryContact: m.id === org.primaryContactId,
    })),
    projects: org.projects.map((p) => ({
      id: p.project.id,
      projectPartnerId: p.id,
      projectName: p.project.name,
      projectStatus: p.project.status,
      active:
        p.project.status !== "Archived" &&
        (p.startedAt === null || p.startedAt <= now) &&
        (p.endedAt === null || p.endedAt > now),
      startedAt: p.startedAt,
      endedAt: p.endedAt,
    })),
    applications: org.applications.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      createdAt: a.createdAt,
    })),
    pendingInvites: pendingInvites.map((i) => ({
      id: i.id,
      email: i.email,
      displayRole: i.displayRole,
      expiresAt: i.expiresAt,
    })),
  };
}
