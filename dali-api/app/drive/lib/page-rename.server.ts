import { HttpError } from "~/lib/http-error";
import type { PageKind, WorkspaceType } from "~/generated/prisma/client";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditProject } from "~/lib/project-access";
import { findNameConflict } from "~/drive/lib/page-names.server";
import { loadManageableNotebook } from "~/drive/lib/notebook-access.server";

export type RenamablePage = {
  id: string;
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  parentPageId: string | null;
  kind: PageKind;
};

export class PageRenameError extends HttpError {
  constructor(message: string, status: number) {
    super(status, message);
    this.name = "PageRenameError";
  }
}

export function isRenamableWorkspace(page: Pick<RenamablePage, "workspaceType" | "workspaceId">): boolean {
  if (page.workspaceType === "Lab") return true;
  if (page.workspaceType === "Project" || page.workspaceType === "EducationOffering" || page.workspaceType === "Member") {
    return !!page.workspaceId;
  }
  return false;
}

export async function canEditPageMetadata(
  actorId: string,
  page: Pick<RenamablePage, "id" | "workspaceType" | "workspaceId">,
  request?: Request,
): Promise<boolean> {
  if (!isRenamableWorkspace(page)) return false;
  if (page.workspaceType === "Project") return canEditProject(actorId, page.workspaceId!, request);
  if (page.workspaceType === "Member" && page.workspaceId === actorId) return true;
  return (await getPageAccess(actorId, page.id, request)).canEdit;
}

export async function resolveRenameTitle(
  page: RenamablePage,
  rawTitle: string,
  actorId: string,
  request?: Request,
): Promise<string> {
  const title = rawTitle.trim();
  if (!title) throw new PageRenameError("Title is required", 400);
  const conflict = await findNameConflict({
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    parentPageId: page.parentPageId,
    kind: page.kind,
    title,
    excludeId: page.id,
  });
  if (conflict) throw new PageRenameError(conflict, 409);
  if (page.kind === "Notebook") await loadManageableNotebook(page.id, actorId, request);
  return title;
}
