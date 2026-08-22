// MCP tool: promote_partner_application — promote a PartnerApplication to a Project.
// Scope: mcp:admin. Gated to isCore.
//
// Mirrors the "promote" action in partners.applications.$id.tsx:
//   - Finds the application and validates it hasn't already been promoted.
//   - Creates a Project seeded from the application's title/summary/terms/domains.
//   - Links the application to the created project via resultingProjectId.
//   - Idempotent: if resultingProjectId is already set, returns alreadyExisted=true.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { githubTeamSlug } from "~/lib/github-slug";
import { McpForbiddenError, McpNotFoundError } from "../../registry";

export const PROMOTE_PARTNER_APPLICATION_TOOL = {
  name: "promote_partner_application",
  description:
    "Promote a partner application to a Project. Seeds the project from the application's title, summary, target terms, and domain scope. Creates ProjectRoleRequest rows (level P1) for domains with expectedMembers > 0 using the earliest target term. Idempotent: if the application was already promoted, returns the existing projectId with alreadyExisted=true. Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      applicationId: { type: "string", description: "PartnerApplication id to promote." },
      orgName: {
        type: "string",
        description:
          "Name for the PartnerOrg created at promotion. Only used when the application has no org yet (account-first). Defaults to the applicant's name as an individual partner.",
      },
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runPromotePartnerApplication(
  callerId: string,
  input: { applicationId: string; orgName?: string },
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can promote partner applications");
  }

  const app = await prisma.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      title: true,
      summary: true,
      resultingProjectId: true,
      partnerOrgId: true,
      applicantContactId: true,
      applicantContact: { select: { id: true, name: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true },
      },
      domains: {
        select: { domainId: true, expectedMembers: true },
      },
    },
  });

  if (!app) throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);

  if (app.resultingProjectId) {
    return { projectId: app.resultingProjectId, alreadyExisted: true };
  }

  // Earliest target term seeds the project term set and scopes per-domain
  // role requests (targetTerms already sorted by sortKey asc).
  const firstTermId = app.targetTerms[0]?.termId ?? null;

  // Domains with headcount > 0 get a P1 role request (staffing board refines later).
  const roleRequestRows = firstTermId
    ? app.domains
        .filter((d) => d.expectedMembers > 0)
        .map((d) => ({
          termId: firstTermId,
          domainId: d.domainId,
          level: "P1" as const,
          slots: d.expectedMembers,
        }))
    : [];

  // The project's domain set is inherited from the distinct domains in role requests.
  const inheritedDomainIds = Array.from(new Set(roleRequestRows.map((r) => r.domainId)));

  const project = await prisma.$transaction(async (tx) => {
    // Account-first: the org is born HERE. Existing (legacy) applications already
    // carry a partnerOrgId; new ones create the org from the applicant contact
    // and add them as its first member.
    let orgId = app.partnerOrgId;
    if (!orgId) {
      const providedName = input.orgName?.trim();
      const org = await tx.partnerOrg.create({
        data: {
          name: providedName || app.applicantContact?.name || app.title,
          isIndividual: !providedName,
        },
        select: { id: true },
      });
      const membership = await tx.partnerMembership.create({
        data: { contactId: app.applicantContactId, orgId: org.id },
        select: { id: true },
      });
      await tx.partnerOrg.update({
        where: { id: org.id },
        data: { primaryContactId: membership.id },
      });
      orgId = org.id;
    }

    const created = await tx.project.create({
      data: {
        name: app.title,
        githubTeamSlug: githubTeamSlug(app.title) || null,
        description: app.summary,
        ...(firstTermId ? { projectTerms: { create: { termId: firstTermId } } } : {}),
        partners: { create: { partnerOrgId: orgId } },
        ...(roleRequestRows.length > 0
          ? { roleRequests: { create: roleRequestRows } }
          : {}),
        ...(inheritedDomainIds.length > 0
          ? {
              domains: {
                create: inheritedDomainIds.map((domainId) => ({ domainId })),
              },
            }
          : {}),
      },
      select: { id: true, name: true },
    });
    await tx.partnerApplication.update({
      where: { id: app.id },
      data: { resultingProjectId: created.id, partnerOrgId: orgId, status: "Promoted" },
    });
    return created;
  });

  return { projectId: project.id, name: project.name, alreadyExisted: false };
}
