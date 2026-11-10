import { prisma } from "~/lib/db.server";
import {
  assertSharePrincipal,
  groupIdsForUser,
  highestPermission,
  labelShares,
  type ShareRow,
} from "~/lib/page-sharing.server";
import type { SharePermission, SharePrincipalType } from "~/generated/prisma/client";

/** The highest permission `userId` holds on `fileId` by name, directly or through a group. */
export async function sharePermissionForFile(
  fileId: string,
  userId: string,
  request?: Request,
): Promise<SharePermission | null> {
  const groupIds = await groupIdsForUser(userId, request);
  const rows = await prisma.fileShare.findMany({
    where: {
      fileId,
      OR: [
        { principalType: "User", principalId: userId },
        ...(groupIds.length ? [{ principalType: "Group" as const, principalId: { in: groupIds } }] : []),
      ],
    },
    select: { permission: true },
  });
  return highestPermission(rows.map((r) => r.permission));
}

export async function listFileShares(fileId: string): Promise<ShareRow[]> {
  const shares = await prisma.fileShare.findMany({
    where: { fileId },
    orderBy: { createdAt: "asc" },
    select: { id: true, principalType: true, principalId: true, permission: true },
  });
  return labelShares(shares);
}

/** Upsert a named grant. `changed` is true for a new row or a level change, and drives the notification. */
export async function addFileShare(
  fileId: string,
  actorId: string,
  principalType: SharePrincipalType,
  principalId: string,
  permission: SharePermission = "View",
): Promise<{ ok: true; alreadyShared: boolean; changed: boolean }> {
  await assertSharePrincipal(principalType, principalId);

  const existing = await prisma.fileShare.findUnique({
    where: { fileId_principalType_principalId: { fileId, principalType, principalId } },
    select: { id: true, permission: true },
  });
  if (existing) {
    if (existing.permission === permission) return { ok: true, alreadyShared: true, changed: false };
    await prisma.fileShare.update({ where: { id: existing.id }, data: { permission } });
    return { ok: true, alreadyShared: true, changed: true };
  }

  await prisma.fileShare.create({
    data: { fileId, principalType, principalId, permission, createdById: actorId },
  });
  return { ok: true, alreadyShared: false, changed: true };
}

/** Scoped by fileId as well so a stale share id can't remove a grant on another file. Returns whether a row went. */
export async function removeFileShare(fileId: string, shareId: string): Promise<boolean> {
  const { count } = await prisma.fileShare.deleteMany({ where: { id: shareId, fileId } });
  return count > 0;
}
