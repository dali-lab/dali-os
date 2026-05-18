import { prisma } from "~/lib/db";
import type { Level } from "~/generated/prisma/client";

// Atomic project creation: Project + overview Page + Overview's CollabDocument
// (cloned from the Project Brief template) + initial PM ProjectAssignments +
// optional ProjectPartner rows.

export interface CreateProjectInput {
  name: string;
  firstTermId: string;
  calendarEmail?: string | null;
  initialPmUserIds: string[];
  partnerOrgIds: string[];
  creatorUserId: string;
}

export interface CreatedProject {
  projectId: string;
  overviewPageId: string;
  overviewDocId: string;
}

const PM_DOMAIN_CODE = "PM";

export async function createProject(
  input: CreateProjectInput,
): Promise<CreatedProject> {
  const { name, firstTermId, calendarEmail, initialPmUserIds, partnerOrgIds, creatorUserId } =
    input;

  // Pull PM-domain row + Project Brief template once before the transaction
  // so we keep the transaction small.
  const pmDomain = await prisma.domain.findUnique({
    where: { code: PM_DOMAIN_CODE },
    select: { id: true },
  });
  if (!pmDomain) {
    throw new Error("PM domain not seeded — run npm run db:seed:v0-reference first");
  }

  // Each PM must have a DomainEligibility(PM). Default level to their highest
  // eligibility (or P3 if none — Core member without explicit eligibility).
  const pmEligibilities = initialPmUserIds.length
    ? await prisma.domainEligibility.findMany({
        where: {
          userId: { in: initialPmUserIds },
          domainId: pmDomain.id,
        },
        select: { userId: true, level: true },
      })
    : [];
  const pmLevels = new Map<string, Level>();
  for (const e of pmEligibilities) pmLevels.set(e.userId, e.level);

  // Project Brief template (may be missing if seed hasn't run; we fall back to
  // an empty Overview doc rather than failing the create).
  const briefTemplate = await prisma.pageTemplate.findFirst({
    where: { name: "Project Brief" },
    select: { contentDocId: true },
  });

  const sourceTemplateDoc = briefTemplate?.contentDocId
    ? await prisma.collabDocument.findUnique({
        where: { name: briefTemplate.contentDocId },
        select: { state: true },
      })
    : null;

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name,
        firstTermId,
        calendarEmail: calendarEmail ?? null,
        status: "Active",
      },
    });

    // Overview doc: project:{id}:overview. Cloned from the Project Brief
    // template body when available, otherwise left absent — the editor will
    // open with an empty Y.Doc on first edit.
    const overviewDocId = `project:${project.id}:overview`;
    if (sourceTemplateDoc) {
      await tx.collabDocument.create({
        data: { name: overviewDocId, state: sourceTemplateDoc.state },
      });
    }

    const page = await tx.page.create({
      data: {
        workspaceType: "Project",
        workspaceId: project.id,
        title: "Overview",
        kind: "FreeForm",
        contentDocId: overviewDocId,
        iconEmoji: "📋",
        createdById: creatorUserId,
        lastEditedById: creatorUserId,
      },
    });

    await tx.project.update({
      where: { id: project.id },
      data: { overviewPageId: page.id },
    });

    // PM ProjectAssignments
    for (const pmId of initialPmUserIds) {
      await tx.projectAssignment.create({
        data: {
          userId: pmId,
          projectId: project.id,
          termId: firstTermId,
          domainId: pmDomain.id,
          level: pmLevels.get(pmId) ?? "P3",
        },
      });
    }

    // Partner links
    for (const partnerOrgId of partnerOrgIds) {
      await tx.projectPartner.create({
        data: {
          projectId: project.id,
          partnerOrgId,
          startedAt: new Date(),
        },
      });
    }

    return {
      projectId: project.id,
      overviewPageId: page.id,
      overviewDocId,
    };
  });
}
