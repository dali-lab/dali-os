import { prisma } from "~/lib/db";

// Each domain's Drive presence: an invisible Folder + an always-present
// Overview FreeForm page (collab doc). The folder uses scopeKind=Group bound
// to the Core group so all Core members can edit, and linkAccess=LabMembers
// so every lab member can view. This mirrors ensureCoreDriveRoot's scoping
// pattern but opens general visibility via linkAccess rather than restricting
// to the scope group.
//
// systemKey scheme:
//   domain:<domainId>:root     — the hub Folder page
//   domain:<domainId>:overview — the always-present Overview FreeForm page
//
// contentDocId for the Overview follows the same naming convention as other
// non-page-scoped docs: a stable string that doubles as the Hocuspocus room
// name. The room is created by the collab server on first write (no DB row
// needed up front).

export type DomainHubResult = {
  folderId: string;
  overviewPageId: string;
  overviewDocId: string;
};

export async function ensureDomainHubRoot(
  domainId: string,
  createdById: string,
): Promise<DomainHubResult> {
  const rootKey = `domain:${domainId}:root`;
  const overviewKey = `domain:${domainId}:overview`;
  // Stable room name; the collab server creates the CollabDocument row on
  // first write — we just need this string to be fixed and unique.
  const overviewDocId = `domain:${domainId}:overview:body`;

  // ── 1. Ensure the hub Folder ────────────────────────────────────────────────
  let folderId: string;

  const existingRoot = await prisma.page.findUnique({
    where: { systemKey: rootKey },
    select: { id: true },
  });

  if (existingRoot) {
    folderId = existingRoot.id;
  } else {
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { displayName: true },
    });
    if (!domain) throw new Error(`Domain ${domainId} not found`);

    // Core group: all Core members get Edit access via scopeKind=Group.
    // The "core" systemKey is the authoritative GroupDefinition for Core.
    const coreGroup = await prisma.groupDefinition.findUnique({
      where: { systemKey: "core" },
      select: { id: true },
    });
    if (!coreGroup) throw new Error("Core GroupDefinition not provisioned");

    try {
      const last = await prisma.page.findFirst({
        where: { workspaceType: "Lab", workspaceId: null, parentPageId: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const created = await prisma.page.create({
        data: {
          workspaceType: "Lab",
          workspaceId: null,
          title: domain.displayName,
          kind: "Folder",
          position: last ? last.position + 1 : 0,
          createdById,
          systemKey: rootKey,
          // Core group members can edit; the scope cascades to children via the
          // ancestry walk in getPageAccess, same as ensureCoreDriveRoot.
          scopeKind: "Group",
          scopeGroupId: coreGroup.id,
          scopePermission: "Edit",
          // Lab-wide readable: any lab member can view. Core (scopeGroup) gets
          // Edit via the scope grant above, which supersedes the link grant.
          linkAccess: "LabMembers",
          linkPermission: "View",
        },
        select: { id: true },
      });
      folderId = created.id;
    } catch {
      const retry = await prisma.page.findUnique({
        where: { systemKey: rootKey },
        select: { id: true },
      });
      if (retry) {
        folderId = retry.id;
      } else {
        throw new Error(`Failed to ensure domain hub root for ${domainId}`);
      }
    }
  }

  // ── 2. Ensure the Overview page ─────────────────────────────────────────────
  let overviewPageId: string;

  const existingOverview = await prisma.page.findUnique({
    where: { systemKey: overviewKey },
    select: { id: true },
  });

  if (existingOverview) {
    overviewPageId = existingOverview.id;
  } else {
    try {
      const last = await prisma.page.findFirst({
        where: { parentPageId: folderId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const created = await prisma.page.create({
        data: {
          workspaceType: "Lab",
          workspaceId: null,
          title: "Overview",
          kind: "FreeForm",
          position: last ? last.position + 1 : 0,
          parentPageId: folderId,
          createdById,
          systemKey: overviewKey,
          // Room name follows the edu-offering pattern: a stable string unique
          // to this resource. Hocuspocus creates the CollabDocument row on first
          // write; we never need to pre-create it.
          contentDocId: overviewDocId,
        },
        select: { id: true },
      });
      overviewPageId = created.id;
    } catch {
      const retry = await prisma.page.findUnique({
        where: { systemKey: overviewKey },
        select: { id: true },
      });
      if (retry) {
        overviewPageId = retry.id;
      } else {
        throw new Error(`Failed to ensure domain hub overview for ${domainId}`);
      }
    }
  }

  return { folderId, overviewPageId, overviewDocId };
}

// Load the child pages inside a domain's hub folder (the "flat page navigator").
// Excludes the Overview page itself (rendered separately as the hub doc), and
// excludes archived pages. Ordered by position ascending.
export async function loadDomainHubPages(
  folderId: string,
  overviewPageId: string,
): Promise<{ id: string; title: string; iconEmoji: string | null }[]> {
  return prisma.page.findMany({
    where: {
      parentPageId: folderId,
      archivedAt: null,
      id: { not: overviewPageId },
    },
    orderBy: { position: "asc" },
    select: { id: true, title: true, iconEmoji: true },
  });
}
