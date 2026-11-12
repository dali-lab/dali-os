import { prisma } from "~/lib/db.server";
import { githubTeamSlug } from "~/lib/github-slug";
import { BadRequestError, NotFoundError } from "~/lib/http-error";
import { setApplicationStage } from "./partner-activity.server";
import { movePlanningNoteToProject } from "./planning-notes.server";
import { reopenProjectFromApplication } from "./partner-returns.server";

export type PromoteResult = {
  projectId: string;
  name?: string;
  alreadyExisted: boolean;
  reopened?: boolean;
};

export async function promotePartnerApplication(input: {
  applicationId: string;
  orgName?: string;
  actorUserId: string;
  request?: Request;
}): Promise<PromoteResult> {
  const { actorUserId, request } = input;
  const app = await prisma.partnerApplication.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      title: true,
      iconEmoji: true,
      piUserId: true,
      summary: true,
      resultingProjectId: true,
      continuesProjectId: true,
      partnerOrgId: true,
      applicantContactId: true,
      applicantContact: { select: { name: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { termId: true },
      },
      domains: { select: { domainId: true, expectedMembers: true } },
    },
  });
  if (!app) throw new NotFoundError(`Partner application ${input.applicationId} not found`);

  if (app.resultingProjectId) {
    return { projectId: app.resultingProjectId, alreadyExisted: true };
  }

  if (app.continuesProjectId) {
    if (app.targetTerms.length === 0) {
      throw new BadRequestError("Set at least one target term before reopening the project.");
    }
    const continuesProjectId = app.continuesProjectId;
    const reopened = await prisma.$transaction((tx) =>
      reopenProjectFromApplication(tx, {
        app: {
          id: app.id,
          continuesProjectId,
          partnerOrgId: app.partnerOrgId,
          piUserId: app.piUserId,
          targetTermIds: app.targetTerms.map((t) => t.termId),
          domains: app.domains,
        },
        actorUserId,
        request,
      }),
    );
    return { projectId: reopened.id, alreadyExisted: false, reopened: true };
  }

  const firstTermId = app.targetTerms[0]?.termId ?? null;
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
  const inheritedDomainIds = Array.from(new Set(roleRequestRows.map((r) => r.domainId)));
  const providedName = input.orgName?.trim() ?? "";

  const project = await prisma.$transaction(async (tx) => {
    let orgId = app.partnerOrgId;
    if (!orgId) {
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
        iconEmoji: app.iconEmoji,
        githubTeamSlug: githubTeamSlug(app.title) || null,
        description: app.summary,
        ...(firstTermId
          ? { projectTerms: { create: { termId: firstTermId, piUserId: app.piUserId } } }
          : {}),
        partners: { create: { partnerOrgId: orgId } },
        ...(roleRequestRows.length > 0 ? { roleRequests: { create: roleRequestRows } } : {}),
        ...(inheritedDomainIds.length > 0
          ? { domains: { create: inheritedDomainIds.map((domainId) => ({ domainId })) } }
          : {}),
      },
      select: { id: true, name: true },
    });
    await setApplicationStage(tx, {
      applicationId: app.id,
      to: "Accepted",
      actorUserId,
      request,
      data: { resultingProjectId: created.id, partnerOrgId: orgId },
      meta: { projectId: created.id },
    });
    await movePlanningNoteToProject(tx, { applicationId: app.id, projectId: created.id });
    return created;
  });

  return { projectId: project.id, name: project.name, alreadyExisted: false };
}
