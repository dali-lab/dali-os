// Keeps the document content index (PageSearchIndex) in step with the page
// bodies it mirrors.
//
// The collab store hook indexes a page the moment it is saved, which covers
// everything edited from now on. This sweep covers the rest: pages that
// predate the index, pages edited while an instance could not write to it, and
// seeded pages whose room name overrides the usual doc:{pageId}:body shape.
//
// Staleness is decided in SQL by comparing CollabDocument.updatedAt against the
// sourceUpdatedAt recorded at index time; only the stale batch is decoded.

import type { JobContext, JobResult } from "~/jobs/registry";
import { prisma } from "~/lib/db.server";
import { stateToBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { indexPageBody } from "~/lib/doc-search.server";

// Y.Doc states are the only heavy thing here, so they are fetched in chunks
// rather than one findMany over the whole batch.
const STATE_CHUNK = 25;

export async function runDocSearchIndex(ctx: JobContext): Promise<JobResult> {
  const batchSize = ctx.settings.batchSize;

  // Archived pages are excluded from search. The room name mirrors pageDocName()
  // unless a seeded page overrides it with contentDocId.
  const rows = await prisma.$queryRaw<
    { pageId: string; name: string; updatedAt: Date; total: bigint }[]
  >`
    SELECT p.id AS "pageId", cd.name, cd."updatedAt", count(*) OVER () AS total
    FROM "Page" p
    JOIN "CollabDocument" cd ON cd.name = COALESCE(p."contentDocId", 'doc:' || p.id || ':body')
    LEFT JOIN "PageSearchIndex" psi ON psi."pageId" = p.id
    WHERE p."archivedAt" IS NULL
      AND (psi."sourceUpdatedAt" IS NULL OR psi."sourceUpdatedAt" < cd."updatedAt")
    ORDER BY cd."updatedAt" ASC
    LIMIT ${batchSize}
  `;
  if (rows.length === 0) return { items: 0, note: "index up to date" };

  const totalStale = Number(rows[0].total);

  let indexedCount = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += STATE_CHUNK) {
    const chunk = rows.slice(i, i + STATE_CHUNK);
    const states = await prisma.collabDocument.findMany({
      where: { name: { in: chunk.map((c) => c.name) } },
      select: { name: true, state: true },
    });
    const stateByName = new Map(states.map((s) => [s.name, s.state]));

    for (const entry of chunk) {
      const state = stateByName.get(entry.name);
      if (!state) continue;
      try {
        const { blocks } = stateToBlocks(new Uint8Array(state));
        await indexPageBody(entry.pageId, blocksToPlainText(blocks), entry.updatedAt);
        indexedCount += 1;
      } catch (err) {
        // One undecodable document must not stall the sweep — the rest of the
        // batch still indexes and this one is retried next tick.
        failed += 1;
        console.error(`[doc-search] sweep failed for page ${entry.pageId}`, err);
      }
    }
  }

  const deferred = totalStale - rows.length;
  return {
    items: indexedCount,
    note:
      `indexed ${indexedCount} page${indexedCount === 1 ? "" : "s"}` +
      (failed > 0 ? `, ${failed} failed` : "") +
      (deferred > 0 ? `, ${deferred} left for the next run` : ""),
  };
}
