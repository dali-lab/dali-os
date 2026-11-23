import { prisma } from "~/lib/db.server";
import { MAX_PAGE_DEPTH, collectSubtree } from "~/lib/pages.server";
import type { Prisma } from "~/generated/prisma/client";

export async function archiveDescendants(
  rootId: string,
  at: Date,
  data: Prisma.PageUpdateManyMutationInput = {},
): Promise<number> {
  const { ids } = await collectSubtree(rootId);
  if (ids.length === 0) return 0;
  await prisma.page.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { ...data, archivedAt: at },
  });
  return ids.length;
}

// Pages trashed with the root share its archivedAt; ones trashed on their own earlier stay in the trash.
export async function restorePageSubtree(rootId: string): Promise<void> {
  const root = await prisma.page.findUnique({ where: { id: rootId }, select: { archivedAt: true } });
  await prisma.page.update({ where: { id: rootId }, data: { archivedAt: null } });
  const at = root?.archivedAt;
  if (!at) return;
  let frontier = [rootId];
  for (let depth = 0; depth < MAX_PAGE_DEPTH && frontier.length > 0; depth++) {
    const children = await prisma.page.findMany({
      where: { parentPageId: { in: frontier }, archivedAt: at },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    if (frontier.length === 0) break;
    await prisma.page.updateMany({ where: { id: { in: frontier } }, data: { archivedAt: null } });
  }
}
