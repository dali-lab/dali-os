// Generic PageShare primitives, shared by personal notes and lab-wide
// documents.
//
// PageShare is the same additive grant in both places — "this principal may
// read this page, regardless of the page's own visibility switch" — so the
// membership resolution, the add/remove writes and the label lookup live here
// once. What differs between the two surfaces is *who may change the list*,
// and that gate stays with each caller: notes require the owner, lab docs
// require the creator or Core.
//
// Nothing in this module authorises anything. Call it behind your own gate.

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import type { SharePrincipalType } from "~/generated/prisma/client";

export type ShareRow = {
  id: string;
  principalType: string;
  principalId: string;
  label: string;
};

/**
 * Group ids whose membership includes this user. Dynamic groups are resolved
 * through resolveGroupMembers rather than reimplemented — the definition of
 * "in a group" has to stay identical to notifications and meeting invites, or
 * sharing would quietly diverge from every other audience in the app.
 */
export async function groupIdsForUser(userId: string): Promise<string[]> {
  const groups = await prisma.groupDefinition.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });
  const memberships = await Promise.all(
    groups.map(async (g) => ({
      id: g.id,
      members: await resolveGroupMembers(g.id),
    })),
  );
  return memberships.filter((g) => g.members.includes(userId)).map((g) => g.id);
}

/** True when `userId` is on `pageId`'s share list, directly or via a group. */
export async function isSharedWith(pageId: string, userId: string): Promise<boolean> {
  const direct = await prisma.pageShare.findFirst({
    where: { pageId, principalType: "User", principalId: userId },
    select: { id: true },
  });
  if (direct) return true;

  const groupIds = await groupIdsForUser(userId);
  if (groupIds.length === 0) return false;
  const viaGroup = await prisma.pageShare.findFirst({
    where: { pageId, principalType: "Group", principalId: { in: groupIds } },
    select: { id: true },
  });
  return viaGroup !== null;
}

/** Who a page is shared with, resolved to display names. */
export async function listPageShares(pageId: string): Promise<ShareRow[]> {
  const shares = await prisma.pageShare.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    select: { id: true, principalType: true, principalId: true },
  });
  if (shares.length === 0) return [];

  const userIds = shares.filter((s) => s.principalType === "User").map((s) => s.principalId);
  const groupIds = shares.filter((s) => s.principalType === "Group").map((s) => s.principalId);
  const [users, groups] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? prisma.groupDefinition.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  return shares.map((s) => ({
    ...s,
    label:
      s.principalType === "User"
        ? (userName.get(s.principalId) ?? "Unknown member")
        : (groupName.get(s.principalId) ?? "Unknown group"),
  }));
}

export class SharePrincipalError extends Error {}

/**
 * Add a principal to a page's share list. Idempotent — re-adding someone
 * reports `alreadyShared` rather than failing, so a double-click in the picker
 * isn't an error.
 */
export async function addPageShare(
  pageId: string,
  actorId: string,
  principalType: SharePrincipalType,
  principalId: string,
): Promise<{ ok: true; alreadyShared: boolean }> {
  if (principalType === "User") {
    const user = await prisma.user.findUnique({
      where: { id: principalId },
      select: { id: true },
    });
    if (!user) throw new SharePrincipalError("That member no longer exists");
  } else {
    const group = await prisma.groupDefinition.findUnique({
      where: { id: principalId },
      select: { id: true, archivedAt: true },
    });
    if (!group) throw new SharePrincipalError("That group no longer exists");
    if (group.archivedAt) throw new SharePrincipalError("That group is archived");
  }

  const existing = await prisma.pageShare.findUnique({
    where: {
      pageId_principalType_principalId: { pageId, principalType, principalId },
    },
    select: { id: true },
  });
  if (existing) return { ok: true, alreadyShared: true };

  await prisma.pageShare.create({
    data: { pageId, principalType, principalId, createdById: actorId },
  });
  return { ok: true, alreadyShared: false };
}

/** Scoped by pageId as well as shareId so a stale id can't remove someone
 *  else's grant on a different page. */
export async function removePageShare(pageId: string, shareId: string): Promise<void> {
  await prisma.pageShare.deleteMany({ where: { id: shareId, pageId } });
}
