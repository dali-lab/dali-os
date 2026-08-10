// Per-user page state — favorites and last-visited — behind the home
// Favorites panel.
//
// Access is re-checked on read, never cached into the row. Favouriting a page
// is a bookmark, not a grant: if a doc is later restricted or moved, it drops
// out of your list silently rather than becoming a way back in.

import { prisma } from "~/lib/db";
import { getPageAccess, type PageShape } from "~/lib/pageAccess.server";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { cachedForRequest } from "~/lib/request-cache";

export type FavoritePage = {
  /** Page id, or the href for a route favorite. Used as the React key. */
  id: string;
  title: string;
  iconEmoji: string | null;
  workspaceType: string;
  favorited: boolean;
  /** Where the row links. Pages resolve to /documents/:id. */
  href: string;
  /** Route favorites have no Page, so the star must target the href. */
  isRoute: boolean;
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
  request?: Request,
): Promise<T[]> {
  // Access checks are independent per page, so run them concurrently instead of
  // in a sequential await loop. getPageAccess is ~3-5 Neon round trips each, and
  // this helper runs in the shell loader on every navigation (sidebar Favorites
  // + Recent) — the serial loop turned that into dozens of round trips in series
  // and dominated navigation TTFB. Candidate rows are bounded by READ_MULTIPLIER,
  // so checking them all in parallel (rather than stopping early at `limit`) is a
  // small, fixed over-fetch that collapses the latency to one wave. We still keep
  // the first `limit` viewable rows in their original (recency) order.
  const canView = await Promise.all(
    rows.map((row) => getPageAccess(userId, row.page, request).then((a) => a.canView)),
  );
  const kept: T[] = [];
  for (let i = 0; i < rows.length && kept.length < limit; i++) {
    if (canView[i]) kept.push(rows[i]);
  }
  return kept;
}

/**
 * The home panel's list: favorites first (most recently pinned first), then
 * the most recently opened pages that aren't already pinned.
 *
 * Pass `request` to dedupe within one page load: the sidebar (layout.tsx) and
 * the home Favorites panel both read this, and the per-row access checks make it
 * one of the heavier loader helpers — running it twice doubled that cost.
 */
export async function listFavoritesAndRecents(
  userId: string,
  request?: Request,
): Promise<{
  favorites: FavoritePage[];
  recents: FavoritePage[];
}> {
  if (request) {
    return cachedForRequest(request, `favoritesAndRecents:${userId}`, () =>
      computeFavoritesAndRecents(userId, request),
    );
  }
  return computeFavoritesAndRecents(userId);
}

async function computeFavoritesAndRecents(userId: string, request?: Request): Promise<{
  favorites: FavoritePage[];
  recents: FavoritePage[];
}> {
  const [routeRows, pinnedRows, recentRows] = await Promise.all([
    // Route favorites (project hubs, subtabs). No Page to check access on —
    // the destination re-authorises itself when opened, and the label is a
    // snapshot, so the worst case is a dead link the owner can un-star.
    prisma.userFavorite.findMany({
      where: { userId, favoritedAt: { not: null }, href: { not: null } },
      orderBy: { favoritedAt: "desc" },
      select: { href: true, label: true },
    }),
    prisma.userFavorite.findMany({
      where: { userId, favoritedAt: { not: null }, page: { is: { archivedAt: null } } },
      orderBy: { favoritedAt: "desc" },
      take: RECENT_LIMIT * READ_MULTIPLIER,
      select: { page: { select: PAGE_SELECT } },
    }),
    prisma.userFavorite.findMany({
      // Pinned pages are shown above; repeating them under "Recent" would be
      // the same link twice.
      where: {
        userId,
        visitedAt: { not: null },
        favoritedAt: null,
        page: { is: { archivedAt: null } },
      },
      orderBy: { visitedAt: "desc" },
      take: RECENT_LIMIT * READ_MULTIPLIER,
      select: { page: { select: PAGE_SELECT } },
    }),
  ]);

  // pageId is nullable now (route favorites), so narrow before the access
  // check — these two queries only ever match page rows anyway.
  const withPage = <T extends { page: unknown }>(rows: T[]) =>
    rows.filter((r): r is T & { page: PageShape } => r.page != null);

  const [favorites, recents] = await Promise.all([
    viewable(withPage(pinnedRows), userId, RECENT_LIMIT * 2, request),
    viewable(withPage(recentRows), userId, RECENT_LIMIT, request),
  ]);

  const shape = (row: { page: PageShape }, favorited: boolean): FavoritePage => ({
    id: row.page.id,
    title: String(row.page.title ?? ""),
    iconEmoji: (row.page.iconEmoji as string | null) ?? null,
    workspaceType: String(row.page.workspaceType),
    favorited,
    href: `/documents/${row.page.id}`,
    isRoute: false,
  });

  const routes: FavoritePage[] = routeRows
    .filter((r) => !isNavbarRoute(r.href!))
    .map((r) => ({
    id: r.href!,
    title: r.label ?? r.href!,
    iconEmoji: null,
    workspaceType: "Route",
    favorited: true,
    href: r.href!,
    isRoute: true,
  }));

  return {
    // Routes and pages interleave by nothing in particular — both are pins, so
    // they share one list rather than being split into headings the user never
    // asked for.
    favorites: [...routes, ...favorites.map((r) => shape(r, true))],
    recents: recents.map((r) => shape(r, false)),
  };
}

/** Hrefs this user has starred, for the subtab/hub toggles. */
export async function favoriteHrefs(userId: string): Promise<Set<string>> {
  const rows = await prisma.userFavorite.findMany({
    where: { userId, favoritedAt: { not: null }, href: { not: null } },
    select: { href: true },
  });
  return new Set(rows.map((r) => r.href!));
}

/**
 * Star or un-star a URL. `label` is stored on the way in because there is no
 * row to read a name from later.
 */
export async function setRouteFavorite(
  userId: string,
  href: string,
  label: string,
  favorited: boolean,
): Promise<void> {
  const favoritedAt = favorited ? new Date() : null;
  const existing = await prisma.userFavorite.findFirst({
    where: { userId, href },
    select: { id: true },
  });
  if (existing) {
    await prisma.userFavorite.update({
      where: { id: existing.id },
      data: { favoritedAt, label },
    });
    return;
  }
  await prisma.userFavorite.create({ data: { userId, href, label, favoritedAt } });
}

/**
 * Note that this user just opened this page. Fire-and-forget from the loader:
 * a failure here must never cost someone the document they asked for.
 */
export function recordPageVisit(userId: string, pageId: string): void {
  void prisma.userFavorite
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
 * Which of this user's pages are favorited, as a Set for O(1) row flagging.
 * One query per list view rather than one per row.
 */
export async function favoritePageIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.userFavorite.findMany({
    where: { userId, favoritedAt: { not: null }, pageId: { not: null } },
    select: { pageId: true },
  });
  return new Set(rows.map((r) => r.pageId!));
}

/** Whether this user has pinned this page. */
export async function isFavorited(userId: string, pageId: string): Promise<boolean> {
  const row = await prisma.userFavorite.findUnique({
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
  await prisma.userFavorite.upsert({
    where: { userId_pageId: { userId, pageId } },
    create: { userId, pageId, favoritedAt },
    update: { favoritedAt },
  });
}
