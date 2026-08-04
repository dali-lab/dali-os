// Per-user page state — favourites and last-visited — behind the home
// Favourites panel.
//
// Access is re-checked on read, never cached into the row. Favouriting a page
// is a bookmark, not a grant: if a doc is later restricted or moved, it drops
// out of your list silently rather than becoming a way back in.

import { prisma } from "~/lib/db";
import { getPageAccess, type PageShape } from "~/lib/pageAccess.server";

export type FavoritePage = {
  id: string;
  title: string;
  iconEmoji: string | null;
  workspaceType: string;
  favorited: boolean;
};

/** How many recents the panel shows once pins are accounted for. */
export const RECENT_LIMIT = 5;

// Read a few more rows than we display: some will fail the access check below
// (archived, un-shared, moved), and dropping them shouldn't leave the panel
// short. Not unbounded — a wide-open limit would re-check access on every page
// a heavy user has ever opened.
const READ_MULTIPLIER = 3;

const PAGE_SELECT = {
  id: true,
  title: true,
  iconEmoji: true,
  workspaceType: true,
  workspaceId: true,
  archivedAt: true,
  createdById: true,
  partnerVisible: true,
  profileVisible: true,
  labListing: true,
  linkAccess: true,
  linkPermission: true,
} as const;

async function viewable<T extends { page: PageShape }>(
  rows: T[],
  userId: string,
  limit: number,
): Promise<T[]> {
  const kept: T[] = [];
  for (const row of rows) {
    if (kept.length >= limit) break;
    const access = await getPageAccess(userId, row.page);
    if (access.canView) kept.push(row);
  }
  return kept;
}

/**
 * The home panel's list: favourites first (most recently pinned first), then
 * the most recently opened pages that aren't already pinned.
 */
export async function listFavoritesAndRecents(userId: string): Promise<{
  favorites: FavoritePage[];
  recents: FavoritePage[];
}> {
  const [pinnedRows, recentRows] = await Promise.all([
    prisma.userPage.findMany({
      where: { userId, favoritedAt: { not: null }, page: { archivedAt: null } },
      orderBy: { favoritedAt: "desc" },
      take: RECENT_LIMIT * READ_MULTIPLIER,
      select: { page: { select: PAGE_SELECT } },
    }),
    prisma.userPage.findMany({
      // Pinned pages are shown above; repeating them under "Recent" would be
      // the same link twice.
      where: {
        userId,
        visitedAt: { not: null },
        favoritedAt: null,
        page: { archivedAt: null },
      },
      orderBy: { visitedAt: "desc" },
      take: RECENT_LIMIT * READ_MULTIPLIER,
      select: { page: { select: PAGE_SELECT } },
    }),
  ]);

  const [favorites, recents] = await Promise.all([
    viewable(pinnedRows, userId, RECENT_LIMIT * 2),
    viewable(recentRows, userId, RECENT_LIMIT),
  ]);

  const shape = (row: { page: (typeof pinnedRows)[number]["page"] }, favorited: boolean) => ({
    id: row.page.id,
    title: row.page.title,
    iconEmoji: row.page.iconEmoji,
    workspaceType: String(row.page.workspaceType),
    favorited,
  });

  return {
    favorites: favorites.map((r) => shape(r, true)),
    recents: recents.map((r) => shape(r, false)),
  };
}

/**
 * Note that this user just opened this page. Fire-and-forget from the loader:
 * a failure here must never cost someone the document they asked for.
 */
export function recordPageVisit(userId: string, pageId: string): void {
  void prisma.userPage
    .upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId, visitedAt: new Date() },
      update: { visitedAt: new Date() },
    })
    .catch((err) => {
      console.error("page visit write failed", {
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Which of this user's pages are favourited, as a Set for O(1) row flagging.
 * One query per list view rather than one per row.
 */
export async function favoritePageIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.userPage.findMany({
    where: { userId, favoritedAt: { not: null } },
    select: { pageId: true },
  });
  return new Set(rows.map((r) => r.pageId));
}

/** Whether this user has pinned this page. */
export async function isFavorited(userId: string, pageId: string): Promise<boolean> {
  const row = await prisma.userPage.findUnique({
    where: { userId_pageId: { userId, pageId } },
    select: { favoritedAt: true },
  });
  return row?.favoritedAt != null;
}

/**
 * Pin or unpin. Callers must confirm the user can view the page first — this
 * writes without checking, so that the gate lives with the route that knows
 * why it's allowed.
 */
export async function setFavorite(
  userId: string,
  pageId: string,
  favorited: boolean,
): Promise<void> {
  const favoritedAt = favorited ? new Date() : null;
  await prisma.userPage.upsert({
    where: { userId_pageId: { userId, pageId } },
    create: { userId, pageId, favoritedAt },
    update: { favoritedAt },
  });
}
