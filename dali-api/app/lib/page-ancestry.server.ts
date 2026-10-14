import { prisma } from "~/lib/db";
import { MAX_PAGE_DEPTH } from "~/lib/pages";
import type { AncestorRow } from "~/lib/pageAccess.server";
import type {
  LinkAccess,
  PageKind,
  ProcessType,
  SharePermission,
  WorkspaceType,
} from "~/generated/prisma/client";

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

/** A chain row with every column the Drive location and the page-access check read. */
export type LocationChainRow = Omit<ChainRow, "title"> & {
  title: string;
  iconEmoji: string | null;
  folderType: string | null;
  processType: ProcessType | null;
  processId: string | null;
  partnerVisible: boolean;
  profileVisible: boolean;
  labListing: string | null;
  linkAccess: LinkAccess | null;
  linkPermission: SharePermission | null;
};

/**
 * `loadAncestorChain` for many pages in one query: each id and its ancestors,
 * nearest first, keyed by the id the walk started from. An id with no page has
 * no entry. `maxRows` caps each chain's length.
 */
export async function loadAncestorChains(
  startIds: ReadonlyArray<string>,
  maxRows: number = CHAIN_ROWS,
): Promise<Map<string, LocationChainRow[]>> {
  const chains = new Map<string, LocationChainRow[]>();
  const ids = [...new Set(startIds)];
  if (ids.length === 0) return chains;
  const limit = Math.trunc(maxRows);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("maxRows must be a positive integer");

  const rows = await prisma.$queryRawUnsafe<Array<LocationChainRow & { startId: string }>>(
    `WITH RECURSIVE chain AS (
      SELECT p."id" AS "startId", p."id", p."title", p."parentPageId", p."scopeKind", p."scopeGroupId",
             p."scopePermission", p."createdById", p."workspaceType", p."workspaceId",
             p."kind", p."archivedAt", p."iconEmoji", p."folderType", p."processType", p."processId",
             p."partnerVisible", p."profileVisible", p."labListing", p."linkAccess", p."linkPermission",
             0 AS "depth"
      FROM "Page" p
      WHERE p."id" = ANY($1::text[])
      UNION ALL
      SELECT chain."startId", a."id", a."title", a."parentPageId", a."scopeKind", a."scopeGroupId",
             a."scopePermission", a."createdById", a."workspaceType", a."workspaceId",
             a."kind", a."archivedAt", a."iconEmoji", a."folderType", a."processType", a."processId",
             a."partnerVisible", a."profileVisible", a."labListing", a."linkAccess", a."linkPermission",
             chain."depth" + 1
      FROM "Page" a
      JOIN chain ON a."id" = chain."parentPageId"
      WHERE chain."depth" + 1 < ${limit}
    )
    SELECT "startId", "id", "title", "parentPageId", "scopeKind", "scopeGroupId", "scopePermission",
           "createdById", "workspaceType", "workspaceId", "kind", "archivedAt", "iconEmoji", "folderType",
           "processType", "processId", "partnerVisible", "profileVisible", "labListing", "linkAccess",
           "linkPermission"
    FROM chain
    ORDER BY "startId", "depth"`,
    ids,
  );

  for (const { startId, ...row } of rows) {
    const chain = chains.get(startId);
    if (chain) chain.push(row);
    else chains.set(startId, [row]);
  }
  return chains;
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
