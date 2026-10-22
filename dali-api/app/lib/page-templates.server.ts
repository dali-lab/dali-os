import { prisma } from "~/lib/db";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import type { WorkspaceType } from "~/generated/prisma/client";

export type PageTemplateRow = { id: string; title: string; iconEmoji: string | null };

// A Member workspace's templates are its owner's private set: Core gets no
// bypass, matching getPageAccess's Member branch.
async function canListWorkspace(
  userId: string,
  workspaceType: WorkspaceType,
  workspaceId: string | null,
): Promise<boolean> {
  if (workspaceType === "Member") return workspaceId === userId;
  if (await isCore(userId)) return true;
  if (workspaceType === "Lab") return isLabMember(userId);
  if (workspaceType === "Project" && workspaceId) return isProjectMember(userId, workspaceId);
  return false;
}

/** FreeForm template pages in one workspace, or [] when the viewer can't list it.
 *  A Member scope with no id means the viewer's own. */
export async function listPageTemplates(
  userId: string,
  workspaceType: WorkspaceType,
  workspaceId: string | null,
): Promise<PageTemplateRow[]> {
  const scopeId = workspaceType === "Member" ? workspaceId ?? userId : workspaceId;
  if (!(await canListWorkspace(userId, workspaceType, scopeId))) return [];
  const rows = await prisma.page.findMany({
    where: { workspaceType, workspaceId: scopeId, isTemplate: true, archivedAt: null, kind: "FreeForm" },
    orderBy: { title: "asc" },
    select: { id: true, title: true, iconEmoji: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title ?? "", iconEmoji: r.iconEmoji ?? null }));
}
