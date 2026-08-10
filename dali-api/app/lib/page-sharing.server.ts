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
import { cachedForRequest } from "~/lib/request-cache";
import type { SharePrincipalType, SharePermission } from "~/generated/prisma/client";

export type ShareRow = {
  id: string;
  principalType: string;
  principalId: string;
  permission: SharePermission;
  label: string;
  /** Group rows only: how many people that grant actually reaches. */
  memberCount?: number;
};

// Permission tiers ranked low→high. getPageAccess and the manage gate both
// compare against this order; keep it the single source of truth so "higher
// than" never diverges between call sites.
const PERMISSION_RANK: Record<SharePermission, number> = {
  View: 0,
  Comment: 1,
  Edit: 2,
  FullAccess: 3,
};

/** True when `a` grants at least as much as `b`. */
export function permissionAtLeast(a: SharePermission, b: SharePermission): boolean {
  return PERMISSION_RANK[a] >= PERMISSION_RANK[b];
}

/**
 * Group ids whose membership includes this user. Dynamic groups are resolved
 * through resolveGroupMembers rather than reimplemented — the definition of
 * "in a group" has to stay identical to notifications and meeting invites, or
 * sharing would quietly diverge from every other audience in the app.
 */
export async function groupIdsForUser(userId: string, request?: Request): Promise<string[]> {
  // Resolving this walks every active group's membership (resolveGroupMembers
  // per group) — hundreds of ms with dozens of groups. It's purely per-user, but
  // getPageAccess re-derives it once per page, so the sidebar Favorites/Recents
  // read (dozens of pages) multiplied it into seconds of navigation TTFB. Memoize
  // per navigation when a request is threaded through.
  if (request) {
    return cachedForRequest(request, `groupIdsForUser:${userId}`, () => computeGroupIdsForUser(userId));
  }
  return computeGroupIdsForUser(userId);
}

async function computeGroupIdsForUser(userId: string): Promise<string[]> {
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

/**
 * The highest permission `userId` holds on `pageId` via a named share — direct
 * User grant or any Group grant they're a member of — or null if not shared.
 * Resolves group membership exactly like `isSharedWith`, so a permission-aware
 * caller never disagrees with the presence check.
 */
export async function sharePermissionFor(
  pageId: string,
  userId: string,
  request?: Request,
): Promise<SharePermission | null> {
  const groupIds = await groupIdsForUser(userId, request);
  const rows = await prisma.pageShare.findMany({
    where: {
      pageId,
      OR: [
        { principalType: "User", principalId: userId },
        ...(groupIds.length
          ? [{ principalType: "Group" as const, principalId: { in: groupIds } }]
          : []),
      ],
    },
    select: { permission: true },
  });
  if (rows.length === 0) return null;
  return rows.reduce<SharePermission>(
    (best, r) => (PERMISSION_RANK[r.permission] > PERMISSION_RANK[best] ? r.permission : best),
    "View",
  );
}

/** Who a page is shared with, resolved to display names. */
export async function listPageShares(pageId: string): Promise<ShareRow[]> {
  const shares = await prisma.pageShare.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    select: { id: true, principalType: true, principalId: true, permission: true },
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

  // A group row hides how far the grant reaches — "Studio 26S" reads the same
  // whether it's four people or four hundred. Resolve the size so the dialog
  // can say. Dynamic groups have to be resolved to be counted, so this is one
  // query per group; share lists hold a handful, not hundreds.
  const memberCounts = new Map(
    await Promise.all(
      groups.map(async (g): Promise<[string, number]> => [
        g.id,
        (await resolveGroupMembers(g.id)).length,
      ]),
    ),
  );

  return shares.map((s) => ({
    ...s,
    label:
      s.principalType === "User"
        ? (userName.get(s.principalId) ?? "Unknown member")
        : (groupName.get(s.principalId) ?? "Unknown group"),
    ...(s.principalType === "Group" ? { memberCount: memberCounts.get(s.principalId) } : {}),
  }));
}

export class SharePrincipalError extends Error {}

/**
 * Add (or re-level) a principal on a page's share list. Idempotent and an
 * upsert: re-adding someone at the same level reports `alreadyShared` without
 * failing (a double-click isn't an error), and re-adding at a different level
 * changes it. `changed` is true whenever the effective grant moved — a new row
 * or a level change — which is what the caller keys the "shared with you"
 * notification on, so an idempotent no-op re-add stays quiet.
 */
export async function addPageShare(
  pageId: string,
  actorId: string,
  principalType: SharePrincipalType,
  principalId: string,
  permission: SharePermission = "View",
): Promise<{ ok: true; alreadyShared: boolean; changed: boolean }> {
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
    select: { id: true, permission: true },
  });
  if (existing) {
    if (existing.permission === permission) {
      return { ok: true, alreadyShared: true, changed: false };
    }
    await prisma.pageShare.update({
      where: { id: existing.id },
      data: { permission },
    });
    return { ok: true, alreadyShared: true, changed: true };
  }

  await prisma.pageShare.create({
    data: { pageId, principalType, principalId, permission, createdById: actorId },
  });
  return { ok: true, alreadyShared: false, changed: true };
}

/** Scoped by pageId as well as shareId so a stale id can't remove someone
 *  else's grant on a different page. */
export async function removePageShare(pageId: string, shareId: string): Promise<void> {
  await prisma.pageShare.deleteMany({ where: { id: shareId, pageId } });
}
