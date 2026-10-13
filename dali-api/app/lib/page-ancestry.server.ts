import { prisma } from "~/lib/db";
import { MAX_PAGE_DEPTH } from "~/lib/pages";
import type { AncestorRow } from "~/lib/pageAccess.server";
import type { PageKind, WorkspaceType } from "~/generated/prisma/client";

// Longest chain any derivation below reads: isAncestorOf inspects the parent
// of nine rows (steps 0..MAX_PAGE_DEPTH + 2), the other two read fewer.
const CHAIN_ROWS = MAX_PAGE_DEPTH + 3;
// pageDepth gives up on a chain that is still climbing at this many rows.
const DEPTH_ROWS = MAX_PAGE_DEPTH + 2;
// findGoverningScope's walk bound.
const GOVERNING_ROWS = 8;

export type ChainRow = AncestorRow & {
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  kind: PageKind;
  archivedAt: Date | null;
};

/**
 * `startId` and its ancestors, nearest first, in one query. The walks in
 * `pageDepth`, `isAncestorOf` and `findGoverningScope` each cost a query per
 * level; the three helpers below reproduce their answers from these rows.
 * A missing page ends the chain, and the row cap stops cyclic data.
 */
export async function loadAncestorChain(startId: string): Promise<ChainRow[]> {
  // The row cap is a module constant, inlined because a bound parameter would
  // have to be typed for the comparison against the integer depth.
  return prisma.$queryRawUnsafe<ChainRow[]>(
    `WITH RECURSIVE chain AS (
      SELECT p."id", p."title", p."parentPageId", p."scopeKind", p."scopeGroupId",
             p."scopePermission", p."createdById", p."workspaceType", p."workspaceId",
             p."kind", p."archivedAt", 0 AS "depth"
      FROM "Page" p
      WHERE p."id" = $1
      UNION ALL
      SELECT a."id", a."title", a."parentPageId", a."scopeKind", a."scopeGroupId",
             a."scopePermission", a."createdById", a."workspaceType", a."workspaceId",
             a."kind", a."archivedAt", chain."depth" + 1
      FROM "Page" a
      JOIN chain ON a."id" = chain."parentPageId"
      WHERE chain."depth" + 1 < ${CHAIN_ROWS}
    )
    SELECT "id", "title", "parentPageId", "scopeKind", "scopeGroupId", "scopePermission",
           "createdById", "workspaceType", "workspaceId", "kind", "archivedAt"
    FROM chain
    ORDER BY "depth"`,
    startId,
  );
}

/** Same answer as `pageDepth(chain[0].id)`: -1 for a broken or runaway chain. */
export function chainDepth(chain: ReadonlyArray<ChainRow>): number {
  const rows = chain.slice(0, DEPTH_ROWS);
  if (rows.length === 0) return -1;
  const last = rows[rows.length - 1];
  return last.parentPageId === null ? rows.length - 1 : -1;
}

/** Same answer as `isAncestorOf(ancestorId, chain[0].id)`. */
export function chainHasAncestor(chain: ReadonlyArray<ChainRow>, ancestorId: string): boolean {
  return chain.slice(0, CHAIN_ROWS).some((row) => row.parentPageId === ancestorId);
}

/** Same answer as `findGoverningScope(chain[0].id)`: the nearest scoped row. */
export function chainGoverningScope(chain: ReadonlyArray<ChainRow>): ChainRow | null {
  return chain.slice(0, GOVERNING_ROWS).find((row) => row.scopeKind !== null) ?? null;
}
