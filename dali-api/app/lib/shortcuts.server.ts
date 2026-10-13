// Drive shortcuts: a Page of kind Shortcut points at another page and is placed
// like any page. The page itself stays in one primary location; every other
// "filed in" place is a shortcut (specs/drive-and-meeting-notes-review.md, C).
//
// Placing a shortcut shares the target with the folder's audience, under the
// grant contract: the actor needs edit on the folder, the grant is made only
// when the actor can manage the target's sharing and the principal has no share
// yet, and the shortcut records the share it made (Page.grantShareId) so that
// deleting the shortcut removes only that.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import {
  getPageAccess,
  getPageAccessBulk,
  findGoverningScopeFor,
  PAGE_ACCESS_SELECT,
  type AncestorRow,
} from "~/lib/pageAccess.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { addPageShare, SharePrincipalError } from "~/lib/page-sharing.server";
import { ensureProjectGroup, ensureOfferingGroup } from "~/lib/groups";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { MAX_PAGE_DEPTH, pageDepth } from "~/lib/pages";
import { folderPath } from "~/lib/drive-receivers.server";
import { movePage } from "~/lib/page-move.server";
import { logAuditEvent } from "~/lib/audit";
import { shortcutTargetHref } from "~/lib/shortcut-targets";
import type { PageKind, SharePermission, SharePrincipalType, WorkspaceType } from "~/generated/prisma/client";

export type Dest = {
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  parentPageId: string | null;
};

export type GrantPrincipal = {
  principalType: SharePrincipalType;
  principalId: string;
  permission: SharePermission;
};

export class ShortcutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ShortcutError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

function sameDest(a: Dest, b: Dest): boolean {
  return a.workspaceType === b.workspaceType && a.workspaceId === b.workspaceId && a.parentPageId === b.parentPageId;
}

const FOLDER_SELECT = {
  id: true,
  title: true,
  kind: true,
  archivedAt: true,
  workspaceType: true,
  workspaceId: true,
  parentPageId: true,
  scopeKind: true,
  scopeGroupId: true,
  scopePermission: true,
  createdById: true,
} as const;

type LoadedDest = { governing: AncestorRow | null };

async function loadDestination(dest: Dest): Promise<LoadedDest> {
  if (dest.workspaceType === "Member") {
    throw new ShortcutError("Shortcuts can't be placed in My Drive");
  }
  if ((dest.workspaceType === "Lab") !== (dest.workspaceId === null)) {
    throw new ShortcutError("That destination isn't valid");
  }
  if (!dest.parentPageId) return { governing: null };

  const folder = await prisma.page.findUnique({ where: { id: dest.parentPageId }, select: FOLDER_SELECT });
  if (
    !folder ||
    folder.archivedAt !== null ||
    folder.workspaceType !== dest.workspaceType ||
    folder.workspaceId !== dest.workspaceId
  ) {
    throw new ShortcutError("Folder not found", 404);
  }
  if (folder.kind !== "Folder") throw new ShortcutError("Shortcuts can only be placed in a folder");
  return { governing: await findGoverningScopeFor(folder) };
}

async function canEditDestination(dest: Dest, actorId: string, request?: Request): Promise<boolean> {
  if (dest.parentPageId) {
    return (await getPageAccess(actorId, dest.parentPageId, request)).canEdit;
  }
  if (dest.workspaceType === "Lab") return isLabMember(actorId, request);
  if (dest.workspaceType === "EducationOffering") return isOfferingManager(actorId, dest.workspaceId!);
  return (await isCore(actorId, request)) || (await isProjectMember(actorId, dest.workspaceId!, request));
}

async function assertCanPlaceAt(dest: Dest, actorId: string, request?: Request): Promise<LoadedDest> {
  const loaded = await loadDestination(dest);
  if (!(await canEditDestination(dest, actorId, request))) {
    throw new ShortcutError("You can't put things in that folder", 403);
  }
  if (dest.parentPageId) {
    const depth = await pageDepth(dest.parentPageId);
    if (depth < 0 || depth + 1 > MAX_PAGE_DEPTH) throw new ShortcutError("Folder is too deeply nested");
  }
  return loaded;
}

async function systemGroupId(systemKey: string, ensure: () => Promise<unknown>): Promise<string | null> {
  const find = () =>
    prisma.groupDefinition.findUnique({ where: { systemKey }, select: { id: true, archivedAt: true } });
  let group = await find();
  if (!group) {
    await ensure();
    group = await find();
  }
  return group && group.archivedAt === null ? group.id : null;
}

async function principalFor(dest: Dest, governing: AncestorRow | null): Promise<GrantPrincipal | null> {
  if (governing) {
    const permission = governing.scopePermission ?? "Edit";
    switch (governing.scopeKind) {
      case "Group":
        return governing.scopeGroupId
          ? { principalType: "Group", principalId: governing.scopeGroupId, permission }
          : null;
      case "Private":
        return governing.createdById
          ? { principalType: "User", principalId: governing.createdById, permission }
          : null;
      default:
        return null;
    }
  }

  if (dest.workspaceType === "Project") {
    const groupId = await systemGroupId(`project:${dest.workspaceId}`, async () => {
      const project = await prisma.project.findUnique({ where: { id: dest.workspaceId! }, select: { name: true } });
      if (project) await ensureProjectGroup(dest.workspaceId!, project.name);
    });
    return groupId ? { principalType: "Group", principalId: groupId, permission: "Edit" } : null;
  }

  if (dest.workspaceType === "EducationOffering") {
    const groupId = await systemGroupId(`offering:${dest.workspaceId}`, async () => {
      const offering = await prisma.educationOffering.findUnique({
        where: { id: dest.workspaceId! },
        select: { title: true },
      });
      if (offering) await ensureOfferingGroup(dest.workspaceId!, offering.title);
    });
    return groupId ? { principalType: "Group", principalId: groupId, permission: "View" } : null;
  }

  return null;
}

/**
 * Who a shortcut placed at `dest` shares its target with, or null when it
 * shares with nobody: an unscoped Lab folder (Lab pages already default to
 * lab-wide) and a Lab-scoped folder grant nothing.
 */
export async function grantPrincipalFor(dest: Dest): Promise<GrantPrincipal | null> {
  const { governing } = await loadDestination(dest);
  return principalFor(dest, governing);
}

/** An unscoped Lab folder lists a shortcut to every lab member; anywhere else the folder's own audience governs. */
function linkAccessFor(dest: Dest, governing: AncestorRow | null) {
  return dest.workspaceType === "Lab" && governing === null
    ? ({ linkAccess: "LabMembers", linkPermission: "View" } as const)
    : ({ linkAccess: "Restricted", linkPermission: "View" } as const);
}

function liveShortcutWhere(targetPageId: string, dest: Dest) {
  return {
    kind: "Shortcut" as const,
    targetPageId,
    workspaceType: dest.workspaceType,
    workspaceId: dest.workspaceId,
    parentPageId: dest.parentPageId,
    archivedAt: null,
  };
}

async function nextPosition(dest: Dest): Promise<number> {
  const last = await prisma.page.aggregate({
    where: { workspaceType: dest.workspaceType, workspaceId: dest.workspaceId, parentPageId: dest.parentPageId, archivedAt: null },
    _max: { position: true },
  });
  return (last._max.position ?? -1) + 1;
}

type TargetRow = {
  id: string;
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  createdById: string | null;
  title: string;
  kind: PageKind;
};

async function liveTarget(targetPageId: string, actorId: string, request?: Request): Promise<TargetRow> {
  const target = await prisma.page.findUnique({
    where: { id: targetPageId },
    select: { ...PAGE_ACCESS_SELECT, title: true, kind: true },
  });
  if (!target || target.archivedAt !== null) throw new ShortcutError("Document not found", 404);
  if (target.kind === "Shortcut") throw new ShortcutError("A shortcut can't point at another shortcut");
  if (!(await getPageAccess(actorId, target, request)).canView) throw new ShortcutError("Document not found", 404);
  return target;
}

/** Whether the principal already has a share on the target, so the placement has nothing to add or to record. */
async function hasShare(targetId: string, principal: GrantPrincipal): Promise<boolean> {
  const existing = await prisma.pageShare.findUnique({
    where: {
      pageId_principalType_principalId: {
        pageId: targetId,
        principalType: principal.principalType,
        principalId: principal.principalId,
      },
    },
    select: { id: true },
  });
  return existing !== null;
}

/** The principal a placement should grant, or null when there is nobody to grant (none, the actor, or already shared). */
async function principalToGrant(
  target: TargetRow,
  principal: GrantPrincipal | null,
  actorId: string,
): Promise<GrantPrincipal | null> {
  if (!principal) return null;
  if (principal.principalType === "User" && principal.principalId === actorId) return null;
  return (await hasShare(target.id, principal)) ? null : principal;
}

export type CreateShortcutResult = {
  shortcutId: string;
  created: boolean;
  grantShareId: string | null;
  grantDeclined: boolean;
};

export async function createShortcut({
  targetPageId,
  dest,
  actorId,
  request,
}: {
  targetPageId: string;
  dest: Dest;
  actorId: string;
  request?: Request;
}): Promise<CreateShortcutResult> {
  const target = await liveTarget(targetPageId, actorId, request);
  const { governing } = await assertCanPlaceAt(dest, actorId, request);

  const existing = await prisma.page.findFirst({
    where: liveShortcutWhere(target.id, dest),
    select: { id: true, grantShareId: true },
  });
  if (existing) {
    return { shortcutId: existing.id, created: false, grantShareId: existing.grantShareId, grantDeclined: false };
  }

  let shortcutId: string;
  try {
    const row = await prisma.page.create({
      data: {
        workspaceType: dest.workspaceType,
        workspaceId: dest.workspaceId,
        parentPageId: dest.parentPageId,
        title: target.title,
        kind: "Shortcut",
        targetPageId: target.id,
        position: await nextPosition(dest),
        createdById: actorId,
        ...linkAccessFor(dest, governing),
      },
      select: { id: true },
    });
    shortcutId = row.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await prisma.page.findFirst({
      where: liveShortcutWhere(target.id, dest),
      select: { id: true, grantShareId: true },
    });
    if (!raced) throw err;
    return { shortcutId: raced.id, created: false, grantShareId: raced.grantShareId, grantDeclined: false };
  }

  const toGrant = await principalToGrant(target, await principalFor(dest, governing), actorId);
  let grantShareId: string | null = null;
  let grantDeclined = false;
  if (toGrant) {
    if (!(await canManageSharing(target, actorId))) {
      grantDeclined = true;
    } else {
      try {
        await addPageShare(target.id, actorId, toGrant.principalType, toGrant.principalId, toGrant.permission);
        const share = await prisma.pageShare.findUnique({
          where: {
            pageId_principalType_principalId: {
              pageId: target.id,
              principalType: toGrant.principalType,
              principalId: toGrant.principalId,
            },
          },
          select: { id: true },
        });
        grantShareId = share?.id ?? null;
        if (grantShareId) {
          await prisma.page.update({ where: { id: shortcutId }, data: { grantShareId } });
        }
      } catch (err) {
        if (!(err instanceof SharePrincipalError)) throw err;
        grantDeclined = true;
      }
    }
  }

  await logAuditEvent({
    action: "page.shortcut-create",
    userId: actorId,
    targetId: shortcutId,
    metadata: { targetPageId: target.id, granted: grantShareId !== null, declined: grantDeclined },
    request,
  });
  return { shortcutId, created: true, grantShareId, grantDeclined };
}

export async function deleteShortcut(shortcutId: string, actorId: string, request?: Request): Promise<void> {
  const shortcut = await prisma.page.findUnique({
    where: { id: shortcutId },
    select: { id: true, kind: true, workspaceType: true, workspaceId: true, parentPageId: true, targetPageId: true, grantShareId: true },
  });
  if (!shortcut || shortcut.kind !== "Shortcut") throw new ShortcutError("Shortcut not found", 404);
  if (!(await canEditDestination(shortcut, actorId, request))) {
    throw new ShortcutError("You can't remove that shortcut", 403);
  }

  await prisma.$transaction([
    prisma.page.delete({ where: { id: shortcut.id } }),
    ...(shortcut.grantShareId ? [prisma.pageShare.deleteMany({ where: { id: shortcut.grantShareId } })] : []),
  ]);
  await logAuditEvent({
    action: "page.shortcut-delete",
    userId: actorId,
    targetId: shortcut.id,
    metadata: { targetPageId: shortcut.targetPageId, revokedGrant: shortcut.grantShareId !== null },
    request,
  });
}

async function moveOrThrow(args: Parameters<typeof movePage>[0]): Promise<string[]> {
  const result = await movePage(args);
  if (result.ok) return result.clearedReceivers;
  if ("response" in result) throw new ShortcutError("That move isn't valid");
  throw new ShortcutError(result.error, result.status);
}

async function livePage(pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { ...PAGE_ACCESS_SELECT, title: true, kind: true },
  });
  if (!page || page.archivedAt !== null) throw new ShortcutError("Document not found", 404);
  if (page.kind === "Shortcut") throw new ShortcutError("A shortcut can't be placed; place the page it points at");
  return page;
}

/**
 * The multi-select write: move the page to `destinations[primaryIndex]`, then
 * a shortcut for each other destination. Destinations that repeat, or equal
 * the primary, are dropped. Every shortcut destination is checked before the
 * page moves, so a refusal leaves the page where it was.
 */
export async function placePage({
  pageId,
  destinations,
  primaryIndex,
  actorId,
  request,
}: {
  pageId: string;
  destinations: Dest[];
  primaryIndex: number;
  actorId: string;
  request?: Request;
}): Promise<{ primaryId: string; shortcutIds: string[]; declined: number }> {
  const primary = destinations[primaryIndex];
  if (!primary) throw new ShortcutError("Choose a primary location");
  const page = await livePage(pageId);

  const secondaries: Dest[] = [];
  for (const dest of destinations) {
    if (sameDest(dest, primary) || secondaries.some((d) => sameDest(d, dest))) continue;
    secondaries.push(dest);
  }
  for (const dest of secondaries) await assertCanPlaceAt(dest, actorId, request);
  if (primary.workspaceType === "Member") throw new ShortcutError("Documents can't be filed into My Drive");

  const alreadyThere = sameDest(primary, {
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    parentPageId: page.parentPageId,
  });
  if (!alreadyThere) {
    await moveOrThrow({
      pageId,
      userId: actorId,
      request,
      input: {
        parentPageId: primary.parentPageId,
        workspaceType: primary.workspaceType,
        workspaceId: primary.workspaceId,
      },
    });
  }

  const shortcutIds: string[] = [];
  let declined = 0;
  for (const dest of secondaries) {
    const result = await createShortcut({ targetPageId: pageId, dest, actorId, request });
    shortcutIds.push(result.shortcutId);
    if (result.grantDeclined) declined++;
  }
  return { primaryId: pageId, shortcutIds, declined };
}

/**
 * Make the shortcut's folder the page's primary location and leave a shortcut
 * (with that folder's grant) in the old one, in one transaction. The shortcut
 * that was there is consumed.
 */
export async function swapPrimary(
  pageId: string,
  shortcutId: string,
  actorId: string,
  request?: Request,
): Promise<{ primaryId: string; shortcutId: string | null }> {
  const shortcut = await prisma.page.findUnique({
    where: { id: shortcutId },
    select: { id: true, kind: true, archivedAt: true, targetPageId: true, workspaceType: true, workspaceId: true, parentPageId: true },
  });
  if (!shortcut || shortcut.kind !== "Shortcut" || shortcut.archivedAt !== null || shortcut.targetPageId !== pageId) {
    throw new ShortcutError("Shortcut not found", 404);
  }
  const page = await livePage(pageId);

  const oldDest: Dest = { workspaceType: page.workspaceType, workspaceId: page.workspaceId, parentPageId: page.parentPageId };
  const { governing } = await assertCanPlaceAt(oldDest, actorId, request);
  const alreadyLeft = await prisma.page.findFirst({ where: liveShortcutWhere(page.id, oldDest), select: { id: true } });

  const toGrant = alreadyLeft ? null : await principalToGrant(page, await principalFor(oldDest, governing), actorId);
  const grantShareId = toGrant && (await canManageSharing(page, actorId)) ? randomUUID() : null;

  const extraOps = [
    prisma.page.delete({ where: { id: shortcut.id } }),
    ...(alreadyLeft
      ? []
      : [
          ...(grantShareId && toGrant
            ? [
                prisma.pageShare.create({
                  data: {
                    id: grantShareId,
                    pageId: page.id,
                    principalType: toGrant.principalType,
                    principalId: toGrant.principalId,
                    permission: toGrant.permission,
                    createdById: actorId,
                  },
                }),
              ]
            : []),
          prisma.page.create({
            data: {
              ...oldDest,
              title: page.title,
              kind: "Shortcut",
              targetPageId: page.id,
              position: await nextPosition(oldDest),
              createdById: actorId,
              grantShareId,
              ...linkAccessFor(oldDest, governing),
            },
          }),
        ]),
  ];

  await moveOrThrow({
    pageId,
    userId: actorId,
    request,
    input: {
      parentPageId: shortcut.parentPageId,
      workspaceType: shortcut.workspaceType as "Lab" | "Project" | "EducationOffering",
      workspaceId: shortcut.workspaceId,
    },
    extraOps,
  });

  await logAuditEvent({
    action: "page.swap-primary",
    userId: actorId,
    targetId: pageId,
    metadata: { from: oldDest, to: { workspaceType: shortcut.workspaceType, workspaceId: shortcut.workspaceId, parentPageId: shortcut.parentPageId } },
    request,
  });
  const left = await prisma.page.findFirst({ where: liveShortcutWhere(page.id, oldDest), select: { id: true } });
  return { primaryId: pageId, shortcutId: left?.id ?? null };
}

export type ShortcutPlace = {
  shortcutId: string;
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  folderId: string | null;
  path: Array<{ id: string; title: string }>;
};

/** Where a page is also filed, for the "Also in" line: the shortcuts the viewer can see, each with its folder path. */
export async function shortcutsOf(targetId: string, viewerId: string, request?: Request): Promise<ShortcutPlace[]> {
  const rows = await prisma.page.findMany({
    where: { kind: "Shortcut", targetPageId: targetId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: PAGE_ACCESS_SELECT,
  });
  const access = await getPageAccessBulk(viewerId, rows, request);
  const places: ShortcutPlace[] = [];
  for (const row of rows) {
    if (!access.get(row.id)?.canView) continue;
    places.push({
      shortcutId: row.id,
      workspaceType: row.workspaceType,
      workspaceId: row.workspaceId,
      folderId: row.parentPageId,
      path: row.parentPageId ? await folderPath(row.parentPageId) : [],
    });
  }
  return places;
}

/** Where a shortcut leads. No access check: the target enforces its own. */
export async function resolveShortcutTarget(
  shortcutId: string,
): Promise<{ targetId: string; targetKind: PageKind; href: string } | null> {
  const shortcut = await prisma.page.findUnique({
    where: { id: shortcutId },
    select: { kind: true, targetPage: { select: { id: true, kind: true } } },
  });
  if (!shortcut || shortcut.kind !== "Shortcut" || !shortcut.targetPage) return null;
  const { id, kind } = shortcut.targetPage;
  return { targetId: id, targetKind: kind, href: shortcutTargetHref(kind, id) };
}

export async function resolveShortcut(
  shortcutId: string,
  viewerId: string,
  request?: Request,
): Promise<{ targetId: string; targetKind: PageKind; href: string; canOpen: boolean; originalInTrash: boolean } | null> {
  const shortcut = await prisma.page.findUnique({
    where: { id: shortcutId },
    select: { kind: true, targetPage: { select: { ...PAGE_ACCESS_SELECT, kind: true } } },
  });
  if (!shortcut || shortcut.kind !== "Shortcut" || !shortcut.targetPage) return null;
  const target = shortcut.targetPage;
  const originalInTrash = target.archivedAt !== null;
  const access = await getPageAccess(viewerId, target, request, { includeArchived: true });
  return {
    targetId: target.id,
    targetKind: target.kind,
    href: shortcutTargetHref(target.kind, target.id),
    canOpen: access.canView && !originalInTrash,
    originalInTrash,
  };
}
