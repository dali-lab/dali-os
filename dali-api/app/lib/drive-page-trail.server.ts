import { prisma } from "~/lib/db.server";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import type { DrivePageAncestry } from "~/lib/drive-page-trail";

export async function loadDrivePageAncestry(
  page: { title: string; iconEmoji: string | null; workspaceType: string; workspaceId: string | null; parentPageId: string | null },
  userId: string,
  request: Request,
): Promise<DrivePageAncestry> {
  let hubName: string | null = null;
  let hubHref: string | null = null;
  let hubIconEmoji: string | null = null;
  if (page.workspaceType === "Project" && page.workspaceId) {
    const project = await prisma.project.findUnique({
      where: { id: page.workspaceId },
      select: { name: true, iconEmoji: true },
    });
    if (project) {
      hubName = project.name;
      hubHref = `/projects/${page.workspaceId}`;
      hubIconEmoji = project.iconEmoji;
    }
  } else if (page.workspaceType === "EducationOffering" && page.workspaceId) {
    const offering = await prisma.educationOffering.findUnique({
      where: { id: page.workspaceId },
      select: { title: true },
    });
    if (offering) {
      hubName = offering.title;
      hubHref = `/education/${page.workspaceId}/hub`;
    }
  }
  const driveCrumbs = await driveFolderCrumbs(page.parentPageId, userId, request);
  return {
    title: page.title,
    iconEmoji: page.iconEmoji,
    workspaceType: page.workspaceType,
    hubName,
    hubHref,
    hubIconEmoji,
    driveCrumbs,
  };
}
