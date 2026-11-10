import { prisma } from "~/lib/db.server";
import { loadAncestorChains } from "~/lib/page-ancestry.server";
import { nearestRoot } from "~/lib/drive-roots";
import type { MoveConstraint } from "~/components/drive/picker-rows";

/** The destination limits the move rules put on these pages, for the picker to apply. */
export async function moveConstraintFor(pageIds: string[]): Promise<MoveConstraint> {
  const pages = await prisma.page.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, parentPageId: true, folderType: true, workspaceType: true, workspaceId: true },
  });
  const parentIds = pages.flatMap((p) => (p.parentPageId ? [p.parentPageId] : []));
  const chains = await loadAncestorChains(parentIds);

  const rootFolderIds = new Set<string>();
  const workspaces = new Map<string, MoveConstraint["workspaces"][number]>();
  for (const page of pages) {
    const root = page.parentPageId ? nearestRoot(chains.get(page.parentPageId) ?? []) : null;
    if (root) rootFolderIds.add(root.id);
    if (page.folderType) {
      workspaces.set(`${page.workspaceType}:${page.workspaceId}`, {
        type: page.workspaceType,
        id: page.workspaceId,
      });
    }
  }
  return { rootFolderIds: [...rootFolderIds], workspaces: [...workspaces.values()] };
}
