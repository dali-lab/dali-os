import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";

export interface FileAccessShape {
  projectId?: string | null;
  workspaceType?: string | null;
  workspaceId?: string | null;
  folderPageId?: string | null;
}

/** Whether `userSub` may view/download the file. A file in a folder follows that folder's access. */
export async function canViewFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (file.workspaceType === "Member") return file.workspaceId === userSub;
  if (file.folderPageId) {
    return (await getPageAccess(userSub, file.folderPageId, request)).canView;
  }
  return isLabMember(userSub, request);
}

/** Whether `userSub` may edit (rename/reversion/delete) the file. */
export async function canEditFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (file.workspaceType === "Member") return file.workspaceId === userSub;
  if (file.folderPageId) {
    return (await getPageAccess(userSub, file.folderPageId, request)).canEdit;
  }
  if (file.projectId) {
    return (await isCore(userSub, request)) || (await isProjectMember(userSub, file.projectId));
  }
  if (file.workspaceType === "Lab") return isLabMember(userSub, request);
  return false;
}
