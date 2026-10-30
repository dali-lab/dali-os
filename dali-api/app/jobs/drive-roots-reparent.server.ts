import { prisma } from "~/lib/db.server";
import { resolveCoreActor } from "~/jobs/core-actor.server";
import { ensureAllRoots } from "~/lib/drive-roots.server";
import { collectSubtree, MAX_PAGE_DEPTH } from "~/lib/pages";
import type { JobResult } from "~/jobs/registry";

export const LEGACY_HIRING_FOLDER_TITLES = ["Hiring Forms", "Application Templates", "Rubrics"] as const;

const HIRING_CYCLE_FORM = {
  OR: [
    { hiringCyclesAsApplicationForm: { some: {} } },
    { hiringCyclesAsContinuedInterestForm: { some: {} } },
    { hiringDomainChallenges: { some: {} } },
  ],
};

export type ReparentCounts = { moved: number; skipped: number; alreadyPlaced: number };

function abort(reason: string): JobResult {
  console.warn(`drive-roots-reparent aborted: ${reason}`);
  return { items: 0, note: `Aborted: ${reason}` };
}

export async function runDriveRootsReparent(): Promise<JobResult> {
  const resolved = await resolveCoreActor();
  if ("abort" in resolved) return abort(resolved.abort);
  const { actorId: actor, coreGroupId } = resolved;

  const roots = await ensureAllRoots(actor);

  const [tops, alreadyPlaced] = await Promise.all([
    prisma.page.findMany({
      where: {
        workspaceType: "Lab",
        workspaceId: null,
        parentPageId: null,
        kind: "Folder",
        archivedAt: null,
        scopeKind: "Group",
        scopeGroupId: coreGroupId,
        folderType: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    }),
    prisma.page.count({
      where: { parentPageId: { in: [roots.core, roots.hiring] }, kind: "Folder", archivedAt: null },
    }),
  ]);
  const holdingCycleForms = await prisma.form.findMany({
    where: { folderPageId: { in: tops.map((t) => t.id) }, ...HIRING_CYCLE_FORM },
    select: { folderPageId: true },
  });
  const hiringFolderIds = new Set(holdingCycleForms.map((f) => f.folderPageId));
  const isHiringFolder = (top: { id: string; title: string }) =>
    (LEGACY_HIRING_FOLDER_TITLES as readonly string[]).includes(top.title) || hiringFolderIds.has(top.id);

  const counts: ReparentCounts = { moved: 0, skipped: 0, alreadyPlaced };
  const skippedTitles: string[] = [];
  for (const top of tops) {
    const { height } = await collectSubtree(top.id);
    if (1 + height > MAX_PAGE_DEPTH) {
      counts.skipped++;
      skippedTitles.push(top.title);
      continue;
    }
    const parentPageId = isHiringFolder(top) ? roots.hiring : roots.core;
    await prisma.page.update({ where: { id: top.id }, data: { parentPageId } });
    counts.moved++;
  }

  const note =
    `moved ${counts.moved}, skipped ${counts.skipped}, already placed ${counts.alreadyPlaced}` +
    (skippedTitles.length ? `; too deep to nest: ${skippedTitles.join(", ")}` : "");
  console.log(`drive-roots-reparent: ${note}`);
  return { items: counts.moved, note };
}
