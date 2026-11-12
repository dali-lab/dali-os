import { BadRequestError, ForbiddenError, NotFoundError } from "~/lib/http-error";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { canManageFileSharing, canViewFile } from "~/lib/fileAccess.server";
import { addFileShare, removeFileShare } from "~/lib/file-sharing.server";
import type { SharePrincipalType } from "~/generated/prisma/client";
import type { LinkAccess, SharePermission } from "~/generated/prisma/client";

export class FileShareNotFoundError extends NotFoundError {
  constructor() {
    super("File not found");
    this.name = "FileShareNotFoundError";
  }
}

export class FileShareForbiddenError extends ForbiddenError {
  constructor() {
    super("You can't manage this file's sharing");
    this.name = "FileShareForbiddenError";
  }
}

export class FileGeneralAccessError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "FileGeneralAccessError";
  }
}

export type FileInheritedAccess = {
  kind: "folder" | "project" | "lab";
  name: string;
};

export type FileShareManagerContext = {
  file: { id: string; title: string; workspaceType: string | null };
  owner: { id: string; name: string; isYou: boolean } | null;
  linkAccess: LinkAccess;
  linkPermission: SharePermission;
  inheritedAccess: FileInheritedAccess | null;
};

const MANAGE_SELECT = {
  id: true,
  title: true,
  projectId: true,
  workspaceType: true,
  workspaceId: true,
  folderPageId: true,
  archivedAt: true,
  linkAccess: true,
  linkPermission: true,
  project: { select: { name: true } },
  versions: { orderBy: { createdAt: "asc" as const }, take: 1, select: { uploadedById: true } },
} as const;

/** Who already has access through where the file lives, for the dialog's read-only row. Null for My Drive. */
async function describeInherited(file: {
  workspaceType: string | null;
  folderPageId: string | null;
  projectId: string | null;
  project: { name: string } | null;
}): Promise<FileInheritedAccess | null> {
  if (file.workspaceType === "Member") return null;
  if (file.folderPageId) {
    const folder = await prisma.page.findUnique({
      where: { id: file.folderPageId },
      select: { title: true },
    });
    return { kind: "folder", name: folder?.title || "Untitled folder" };
  }
  if (file.projectId) return { kind: "project", name: file.project?.name ?? "this project" };
  return { kind: "lab", name: "the Lab" };
}

/**
 * Load a file and assert `userId` may manage its sharing. A user who can't even
 * see the file gets the same not-found as a missing one; a viewer who can't manage it gets forbidden.
 */
export async function requireFileShareManager(
  fileId: string,
  userId: string,
  request?: Request,
): Promise<FileShareManagerContext> {
  const file = await prisma.projectFile.findUnique({ where: { id: fileId }, select: MANAGE_SELECT });
  if (!file || file.archivedAt) throw new FileShareNotFoundError();

  if (!(await canManageFileSharing(userId, file, request))) {
    if (!(await canViewFile(userId, file, request))) throw new FileShareNotFoundError();
    throw new FileShareForbiddenError();
  }

  const ownerId = file.workspaceType === "Member" ? file.workspaceId : file.versions[0]?.uploadedById;
  const ownerRow = ownerId
    ? await prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true, firstName: true, lastName: true },
      })
    : null;

  return {
    file: { id: file.id, title: file.title, workspaceType: file.workspaceType },
    owner: ownerRow
      ? {
          id: ownerRow.id,
          name: `${ownerRow.firstName} ${ownerRow.lastName}`.trim() || "Unknown",
          isYou: ownerRow.id === userId,
        }
      : null,
    linkAccess: file.linkAccess,
    linkPermission: file.linkPermission,
    inheritedAccess: await describeInherited(file),
  };
}

/**
 * Set a file's General access. Caller MUST gate first (requireFileShareManager).
 * Links never grant FullAccess, and files have no signed-out download path, so
 * only Restricted and LabMembers are offered. Restricted resets the level to View.
 */
export async function setFileGeneralAccess(
  fileId: string,
  actorId: string,
  input: { linkAccess: LinkAccess; linkPermission: SharePermission },
): Promise<{ linkAccess: LinkAccess; linkPermission: SharePermission }> {
  const { linkAccess } = input;
  if (linkAccess !== "Restricted" && linkAccess !== "LabMembers") {
    throw new FileGeneralAccessError("Files can only be shared with the lab, not with the public");
  }
  if (input.linkPermission === "FullAccess") {
    throw new FileGeneralAccessError("Links can't grant full access");
  }
  const linkPermission = linkAccess === "Restricted" ? "View" : input.linkPermission;
  await prisma.projectFile.update({ where: { id: fileId }, data: { linkAccess, linkPermission } });
  await logAuditEvent({
    action: "projectFile.general-access",
    userId: actorId,
    targetId: fileId,
    metadata: { linkAccess, linkPermission },
  });
  return { linkAccess, linkPermission };
}

/** "Shared with you" notification for a named person whose access on the file changed. */
export async function notifyFileShared(args: {
  fileId: string;
  fileTitle: string;
  recipientUserId: string;
  actorId: string;
}): Promise<void> {
  const { notify } = await import("~/lib/notify.server");
  await notify({
    eventType: "document.shared_with_you",
    createdByUserId: args.actorId,
    message: {
      vars: { itemTitle: args.fileTitle },
      link: `/documents/file/${args.fileId}`,
    },
    recipients: [{ userId: args.recipientUserId }],
  });
}

/** Gate, grant, audit and notify: the one path a named file share takes, for the web route and MCP alike. */
export async function shareFileWith(args: {
  fileId: string;
  actorId: string;
  principalType: SharePrincipalType;
  principalId: string;
  permission: SharePermission;
  request?: Request;
  via?: "mcp";
}): Promise<{ ok: true; alreadyShared: boolean; changed: boolean }> {
  const { fileId, actorId, principalType, principalId, permission, request } = args;
  const context = await requireFileShareManager(fileId, actorId, request);
  const res = await addFileShare(fileId, actorId, principalType, principalId, permission);
  if (!res.changed) return res;
  await logAuditEvent({
    action: "projectFile.share",
    userId: actorId,
    targetId: fileId,
    metadata: { principalType, principalId, permission, ...(args.via ? { via: args.via } : {}) },
    request,
  });
  if (principalType === "User" && principalId !== actorId) {
    await notifyFileShared({
      fileId,
      fileTitle: context.file.title,
      recipientUserId: principalId,
      actorId,
    });
  }
  return res;
}

export async function unshareFile(args: {
  fileId: string;
  actorId: string;
  shareId: string;
  request?: Request;
  via?: "mcp";
}): Promise<void> {
  const { fileId, actorId, shareId, request } = args;
  await requireFileShareManager(fileId, actorId, request);
  if (await removeFileShare(fileId, shareId)) {
    await logAuditEvent({
      action: "projectFile.unshare",
      userId: actorId,
      targetId: fileId,
      metadata: { shareId, ...(args.via ? { via: args.via } : {}) },
      request,
    });
  }
}
