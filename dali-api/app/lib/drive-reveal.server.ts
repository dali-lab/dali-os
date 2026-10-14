// Where "Reveal in Drive" lands for a page: the deepest folder above it that
// the viewer can open, in the space it lives in. A page the viewer reaches only
// by a named share has no place in their own Drive tree, so it lands on the
// Shared with me space instead.

import { prisma } from "~/lib/db";
import { PAGE_ACCESS_SELECT, getPageAccess } from "~/lib/pageAccess.server";
import { driveFolderCrumbs, type DriveCrumbs } from "~/lib/drive-crumbs.server";
import { workspaceDriveScope } from "~/lib/drive-crumbs";
import { SHARED_SPACE_KEY } from "~/lib/drive-spaces";

export function driveHref(scope: string, folderId?: string | null, select?: string | null): string {
  return `/drive?scope=${scope}${folderId ? `&folder=${folderId}` : ""}${select ? `&select=${select}` : ""}`;
}

/**
 * Where a page whose nearest folder is `anchor` sits in the Drive: the space,
 * the folders above it the viewer can open (top-most first), and, for a
 * project or offering, the synthetic top-level folder the Drive keys by the
 * workspace id.
 */
export async function driveLocation(
  anchor: string | null,
  page: { workspaceType: string; workspaceId: string | null },
  viewerSub: string,
  request?: Request,
) {
  return locationFromCrumbs(await driveFolderCrumbs(anchor, viewerSub, request), page);
}

export function locationFromCrumbs(
  crumbs: DriveCrumbs,
  page: { workspaceType: string; workspaceId: string | null },
) {
  const scope = workspaceDriveScope(page.workspaceType) ?? crumbs.scope;
  const workspaceFolderId =
    (scope === "projects" || scope === "education") && page.workspaceId ? page.workspaceId : null;
  return { scope, folders: crumbs.folders, workspaceFolderId };
}

/** Null when the page does not exist or the viewer cannot open it. */
export async function driveRevealHref(
  pageId: string,
  viewerSub: string,
  request?: Request,
): Promise<string | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { ...PAGE_ACCESS_SELECT, kind: true },
  });
  if (!page || page.archivedAt) return null;
  if (!(await getPageAccess(viewerSub, page, request)).canView) return null;

  const base = await getPageAccess(viewerSub, page, request, { ignoreShares: true });
  if (!base.canView) return driveHref(SHARED_SPACE_KEY, null, pageId);

  // A folder reveals itself. A note in a notebook reveals the notebook's
  // folder, because the Drive shows a notebook as one item and never lists its
  // tabs. The item to select is whatever the Drive lists: a folder is the
  // place it opens, so there is nothing in it to select, and a note in a
  // notebook is listed as the notebook.
  let anchor: string | null = page.kind === "Folder" ? page.id : page.parentPageId;
  let select: string | null = page.kind === "Folder" ? null : pageId;
  if (anchor && page.kind !== "Folder") {
    const parent = await prisma.page.findUnique({
      where: { id: anchor },
      select: { kind: true, parentPageId: true },
    });
    if (parent?.kind === "Notebook") {
      select = anchor;
      anchor = parent.parentPageId;
    }
  }

  const where = await driveLocation(anchor, page, viewerSub, request);
  return driveHref(where.scope, where.folders.at(-1)?.id ?? where.workspaceFolderId, select);
}
