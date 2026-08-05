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
    },
    required: ["applicationId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

export async function runPromotePartnerApplication(
  callerId: string,
  input: { applicationId: string },
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
    const created = await tx.project.create({
      data: {
        name: app.title,
        githubTeamSlug: githubTeamSlug(app.title) || null,
        description: app.summary,
        ...(firstTermId ? { projectTerms: { create: { termId: firstTermId } } } : {}),
        partners: { create: { partnerOrgId: app.partnerOrgId } },
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
      data: { resultingProjectId: created.id },
    });
    return created;
  });

  return { projectId: project.id, name: project.name, alreadyExisted: false };
}
