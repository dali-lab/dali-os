import { prisma } from "~/lib/db.server";
import { collectSubtree } from "~/lib/pages.server";
import type { Prisma } from "~/generated/prisma/client";

export async function archiveDescendants(
  rootId: string,
  data: Prisma.PageUpdateManyMutationInput = {},
): Promise<number> {
  const { ids } = await collectSubtree(rootId);
  if (ids.length === 0) return 0;
  await prisma.page.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { ...data, archivedAt: new Date() },
  });
  return ids.length;
}
