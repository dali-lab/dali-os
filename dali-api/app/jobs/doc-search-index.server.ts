// Keeps the document content index (PageSearchIndex) in step with the page
// bodies it mirrors.
//
// The collab store hook indexes a page the moment it is saved, which covers
// everything edited from now on. This sweep covers the rest: pages that
// predate the index, pages edited while an instance could not write to it, and
// seeded pages whose room name overrides the usual doc:{pageId}:body shape.
//
// Staleness is decided by comparing CollabDocument.updatedAt against the
// sourceUpdatedAt recorded at index time, so a steady state costs two cheap
// column reads and decodes nothing.

import type { JobContext, JobResult } from "~/jobs/registry";
import { prisma } from "~/lib/db";
import { pageDocName } from "~/collab/roomName";
import { stateToBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { indexPageBody } from "~/lib/doc-search.server";

// Y.Doc states are the only heavy thing here, so they are fetched in chunks
// rather than one findMany over the whole batch.
const STATE_CHUNK = 25;

export async function runDocSearchIndex(ctx: JobContext): Promise<JobResult> {
  const batchSize = ctx.settings.batchSize;

  // Archived pages are excluded from search, so leave their rows alone —
  // un-archiving bumps nothing, but the next edit re-indexes, and a stale row
  // for a hidden page is invisible either way.
  const pages = await prisma.page.findMany({
    where: { archivedAt: null },
    select: { id: true, contentDocId: true },
  });
  if (pages.length === 0) return { items: 0, note: "no pages" };

  // Room name → page id. Mirrors the read paths (MCP read_page, exports):
  // contentDocId when a seeded page overrides it, else the standard shape.
  const pageIdByDocName = new Map(
    pages.map((p) => [p.contentDocId ?? pageDocName(p.id), p.id]),
  );

  const [docs, indexed] = await Promise.all([
    prisma.collabDocument.findMany({
      where: { name: { in: [...pageIdByDocName.keys()] } },
      select: { name: true, updatedAt: true },
    }),
    prisma.pageSearchIndex.findMany({ select: { pageId: true, sourceUpdatedAt: true } }),
  ]);

  const indexedAt = new Map(indexed.map((r) => [r.pageId, r.sourceUpdatedAt]));
  const allStale = docs
    .flatMap((doc) => {
      const pageId = pageIdByDocName.get(doc.name);
      if (!pageId) return [];
      const seen = indexedAt.get(pageId);
      if (seen && seen >= doc.updatedAt) return [];
      return [{ pageId, name: doc.name, updatedAt: doc.updatedAt }];
    })
    // Oldest edit first, so a backlog drains in a stable order instead of
    // re-picking the same rows every tick.
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  if (allStale.length === 0) return { items: 0, note: "index up to date" };

  const stale = allStale.slice(0, batchSize);

  let indexedCount = 0;
  let failed = 0;

  for (let i = 0; i < stale.length; i += STATE_CHUNK) {
    const chunk = stale.slice(i, i + STATE_CHUNK);
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

  const deferred = allStale.length - stale.length;
  return {
    items: indexedCount,
    note:
      `indexed ${indexedCount} page${indexedCount === 1 ? "" : "s"}` +
      (failed > 0 ? `, ${failed} failed` : "") +
      (deferred > 0 ? `, ${deferred} left for the next run` : ""),
  };
}
