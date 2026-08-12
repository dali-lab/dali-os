// Access decisions for drive files (ProjectFile rows).
//
// Historically a file's visibility was implicit — the routes that serve files
// only 404'd on missing rows, so any authenticated member could view any file
// by URL. That's fine for the communal cases (lab-root files, project files),
// but the Drive now places files in *private* (My Drive) and *scoped* (Core)
// drives, which must not leak. These helpers add the missing checks for exactly
// those cases while leaving the communal default untouched (no regression):
//
//   • Member (My Drive) files → owner only.
//   • Files inside a scoped folder (e.g. Core) → follow the folder's access
//     (getPageAccess on the containing folder — the same scope=group cascade).
//   • Everything else → the pre-existing behavior.

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess, isUnderGoverningScope } from "~/lib/pageAccess.server";

export interface FileAccessShape {
  projectId?: string | null;
  workspaceType?: string | null;
  workspaceId?: string | null;
  folderPageId?: string | null;
}

/** Whether `userSub` may view/download the file. */
export async function canViewFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  // My Drive files are private to their owner.
  if (file.workspaceType === "Member") return file.workspaceId === userSub;
  // A file inside a scoped folder inherits that folder's access (Core, etc.).
  if (file.folderPageId && (await isUnderGoverningScope(file.folderPageId))) {
    return (await getPageAccess(userSub, file.folderPageId, request)).canView;
  }
  // Communal files (project, lab-root, unscoped folders): unchanged — visible to
  // any authenticated member the calling route already admitted.
  return true;
}

/** Whether `userSub` may edit (rename/reversion/delete) the file. */
export async function canEditFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (file.workspaceType === "Member") return file.workspaceId === userSub;
  if (file.folderPageId && (await isUnderGoverningScope(file.folderPageId))) {
    return (await getPageAccess(userSub, file.folderPageId, request)).canEdit;
  }
  if (file.projectId) {
    return (await isCore(userSub, request)) || (await isProjectMember(userSub, file.projectId));
  }
  if (file.workspaceType === "Lab") return isLabMember(userSub, request);
  return false;
}
