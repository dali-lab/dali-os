import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { sharePermissionForFile } from "~/lib/file-sharing.server";
import { PERMISSION_RANK } from "~/lib/page-sharing.server";
import type { SharePermission } from "~/generated/prisma/client";

export interface FileAccessShape {
  /** Needed for named shares and link access; without it only inherited access applies. */
  id?: string;
  projectId?: string | null;
  workspaceType?: string | null;
  workspaceId?: string | null;
  folderPageId?: string | null;
  linkAccess?: string | null;
  linkPermission?: string | null;
}

/** Access from where the file lives: the owner, its folder, its project or the Lab. */
export async function inheritedFileView(
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

export async function inheritedFileEdit(
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

/** Named shares and General access on the file itself, never counting inherited access. */
export async function fileGrantLevel(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<SharePermission | null> {
  if (!file.id) return null;
  let level = await sharePermissionForFile(file.id, userSub, request);
  const linkPermission = (file.linkPermission as SharePermission | null | undefined) ?? "View";
  const linked =
    file.linkAccess === "LabMembers" ? await isLabMember(userSub, request) : file.linkAccess === "SignedIn";
  if (linked && (!level || PERMISSION_RANK[linkPermission] > PERMISSION_RANK[level])) {
    level = linkPermission;
  }
  return level;
}

/** Whether `userSub` may view/download the file: inherited access, or a share or link on the file. */
export async function canViewFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (await inheritedFileView(userSub, file, request)) return true;
  return (await fileGrantLevel(userSub, file, request)) !== null;
}

/** Whether `userSub` may edit (rename/reversion/delete) the file. */
export async function canEditFile(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (await inheritedFileEdit(userSub, file, request)) return true;
  const level = await fileGrantLevel(userSub, file, request);
  return level === "Edit" || level === "FullAccess";
}

/** Whether `userSub` may change the file's sharing: it can be edited through where it lives, or they hold FullAccess. */
export async function canManageFileSharing(
  userSub: string,
  file: FileAccessShape,
  request?: Request,
): Promise<boolean> {
  if (await inheritedFileEdit(userSub, file, request)) return true;
  if (!file.id) return false;
  return (await sharePermissionForFile(file.id, userSub, request)) === "FullAccess";
}

type FileWithPlace = FileAccessShape & { id: string };

/** The files in `files` the viewer may see; the inherited check runs once per place (workspace, folder, project). */
export async function filterViewableFiles<T extends FileWithPlace>(
  userSub: string,
  files: T[],
  request?: Request,
): Promise<T[]> {
  const byPlace = new Map<string, Promise<boolean>>();
  const allowed = await Promise.all(
    files.map(async (file) => {
      const place = [file.workspaceType, file.workspaceId, file.folderPageId, file.projectId].join(":");
      let inherited = byPlace.get(place);
      if (!inherited) {
        inherited = inheritedFileView(userSub, file, request);
        byPlace.set(place, inherited);
      }
      return (await inherited) || (await fileGrantLevel(userSub, file, request)) !== null;
    }),
  );
  return files.filter((_, i) => allowed[i]);
}
