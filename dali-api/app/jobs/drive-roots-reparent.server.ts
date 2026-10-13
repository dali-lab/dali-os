import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { ensureAllRoots } from "~/lib/drive-roots.server";
import { HIRING_PROCESS_ID } from "~/lib/bindings.server";
import { collectSubtree, MAX_PAGE_DEPTH } from "~/lib/pages";
import type { JobResult } from "~/jobs/registry";

export type ReparentCounts = { moved: number; skipped: number; alreadyPlaced: number };

function abort(reason: string): JobResult {
  console.warn(`drive-roots-reparent aborted: ${reason}`);
  return { items: 0, note: `Aborted: ${reason}` };
}

export async function runDriveRootsReparent(): Promise<JobResult> {
  const core = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });
  if (!core) return abort("the Core group does not exist");

  const actor = [...(await resolveGroupMembers(core.id))].sort()[0];
  if (!actor) return abort("there are no current Core members to create the roots as");

  const roots = await ensureAllRoots(actor);

  const [bindings, tops, alreadyPlaced] = await Promise.all([
    prisma.processFolderBinding.findMany({
      where: { processType: "HiringCycle", processId: HIRING_PROCESS_ID, folderPageId: { not: null } },
      select: { folderPageId: true },
    }),
    prisma.page.findMany({
      where: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: null,
        kind: "Folder",
        archivedAt: null,
        scopeKind: "Group",
        scopeGroupId: core.id,
        folderType: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    }),
    prisma.page.count({
      where: { parentPageId: { in: [roots.core, roots.hiring] }, kind: "Folder", archivedAt: null },
    }),
  ]);
  const hiringFolderIds = new Set(bindings.map((b) => b.folderPageId));

  const counts: ReparentCounts = { moved: 0, skipped: 0, alreadyPlaced };
  const skippedTitles: string[] = [];
  for (const top of tops) {
    const { height } = await collectSubtree(top.id);
    if (1 + height > MAX_PAGE_DEPTH) {
      counts.skipped++;
      skippedTitles.push(top.title);
      continue;
    }
    const parentPageId = hiringFolderIds.has(top.id) ? roots.hiring : roots.core;
    await prisma.page.update({ where: { id: top.id }, data: { parentPageId } });
    counts.moved++;
  }

  const note =
    `moved ${counts.moved}, skipped ${counts.skipped}, already placed ${counts.alreadyPlaced}` +
    (skippedTitles.length ? `; too deep to nest: ${skippedTitles.join(", ")}` : "");
  console.log(`drive-roots-reparent: ${note}`);
  return { items: counts.moved, note };
}
