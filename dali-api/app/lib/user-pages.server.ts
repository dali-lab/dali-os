// Per-user page state — favorites and last-visited — behind the home
// Favorites panel.
//
// Access is re-checked on read, never cached into the row. Favouriting a page
// is a bookmark, not a grant: if a doc is later restricted or moved, it drops
// out of your list silently rather than becoming a way back in.

import { prisma } from "~/lib/db";
import { getPageAccess, type PageShape } from "~/lib/pageAccess.server";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { isAreaSubtabPath } from "~/lib/nav-areas";
import { cachedForRequest } from "~/lib/request-cache";

/** How a Favorites/Recent row draws its leading icon. */
export type FavoriteIconKind =
  | "page"
  | "project"
  | "person"
  | "org"
  | "offering"
  | "note"
  | "form"
  | "hiring"
  | "route";

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
  /** Which icon the row renders — see FavoriteIcon. */
  iconKind: FavoriteIconKind;
  /** Person photo / org logo, when iconKind is person or org. */
  photoUrl?: string | null;
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
  const [routeRows, pinnedRows, recentRows, routeRecentRows] = await Promise.all([
    // Route favorites (project / person / partner-org detail pages, sub-tabs).
    // No Page to check access on — the destination re-authorises itself when
    // opened, and the worst case is a dead link the owner can un-star.
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
      select: { page: { select: PAGE_SELECT }, visitedAt: true },
    }),
    // Recently opened routes (detail pages) that aren't pinned — the route
    // sibling of the page recents above. Merged with them below by recency.
    prisma.userFavorite.findMany({
      where: { userId, visitedAt: { not: null }, favoritedAt: null, href: { not: null } },
      orderBy: { visitedAt: "desc" },
      take: RECENT_LIMIT * READ_MULTIPLIER,
      select: { href: true, label: true, visitedAt: true },
    }),
  ]);

  // pageId is nullable now (route favorites), so narrow before the access
  // check — these two queries only ever match page rows anyway.
  const withPage = <T extends { page: unknown }>(rows: T[]) =>
    rows.filter((r): r is T & { page: PageShape } => r.page != null);

  const routeFavHrefs = routeRows.map((r) => r.href!).filter((h) => !isNavbarRoute(h));
  const routeRecentHrefs = routeRecentRows.map((r) => r.href!);

  const [favorites, pageRecents, resolved] = await Promise.all([
    viewable(withPage(pinnedRows), userId, RECENT_LIMIT * 2, request),
    viewable(withPage(recentRows), userId, RECENT_LIMIT * READ_MULTIPLIER, request),
    resolveRouteIcons([...new Set([...routeFavHrefs, ...routeRecentHrefs])]),
  ]);

  const shape = (row: { page: PageShape }, favorited: boolean): FavoritePage => ({
    id: row.page.id,
    title: String(row.page.title ?? ""),
    iconEmoji: (row.page.iconEmoji as string | null) ?? null,
    workspaceType: String(row.page.workspaceType),
    favorited,
    href: `/documents/${row.page.id}`,
    isRoute: false,
    iconKind: "page",
  });

  // A route row → FavoritePage using its resolved entity icon/name. Deleted
  // entities keep their favorite (stale label + generic glyph, so the owner can
  // still un-star it) but drop out of recents (dropIfMissing).
  const shapeRoute = (
    href: string,
    label: string | null,
    favorited: boolean,
    dropIfMissing: boolean,
  ): FavoritePage | null => {
    const r = resolved.get(href);
    const asRoute = (): FavoritePage => ({
      id: href,
      title: label ?? href,
      iconEmoji: null,
      workspaceType: "Route",
      favorited,
      href,
      isRoute: true,
      iconKind: "route",
    });
    if (!r || r.iconKind === "route") return asRoute();
    if (!r.found) return dropIfMissing ? null : asRoute();
    return {
      id: href,
      title: r.title ?? label ?? href,
      iconEmoji: r.iconEmoji,
      workspaceType: "Route",
      favorited,
      href,
      isRoute: true,
      iconKind: r.iconKind,
      photoUrl: r.photoUrl,
    };
  };

  const routeFavorites = routeFavHrefs
    .map((h) => {
      const row = routeRows.find((r) => r.href === h)!;
      return shapeRoute(h, row.label, true, false);
    })
    .filter((f): f is FavoritePage => f != null);

  // Merge page + route recents by visit recency, then cap.
  const recentItems: { fav: FavoritePage; visitedAt: Date }[] = [
    ...pageRecents.map((r) => ({ fav: shape(r, false), visitedAt: r.visitedAt! })),
    ...routeRecentRows
      .map((r) => {
        const fav = shapeRoute(r.href!, r.label, false, true);
        return fav ? { fav, visitedAt: r.visitedAt! } : null;
      })
      .filter((x): x is { fav: FavoritePage; visitedAt: Date } => x != null),
  ];
  recentItems.sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());

  return {
    // Routes and pages interleave by nothing in particular — both are pins, so
    // they share one list rather than being split into headings the user never
    // asked for.
    favorites: [...routeFavorites, ...favorites.map((r) => shape(r, true))],
    recents: recentItems.slice(0, RECENT_LIMIT).map((x) => x.fav),
  };
}

type ResolvedRoute = {
  iconKind: FavoriteIconKind;
  title: string | null;
  iconEmoji: string | null;
  photoUrl: string | null;
  /** False when the entity behind the href no longer exists. */
  found: boolean;
};

type RouteRef = { kind: "project" | "person" | "org"; id: string };

// Detail routes we resolve to a real entity icon + live name via a batched
// lookup. Sub-tab landing pages (e.g. /projects/staffing) are also
// single-segment but aren't entities, so they're excluded and fall back to
// their nav-area glyph.
function parseRouteHref(href: string): RouteRef | null {
  let path: string;
  try {
    path = new URL(href, "http://local").pathname;
  } catch {
    return null;
  }
  if (isAreaSubtabPath(path)) return null;
  const m = /^\/(projects|members|partners)\/([^/]+)$/.exec(path);
  if (!m) return null;
  const id = m[2];
  if (m[1] === "projects") return { kind: "project", id };
  if (m[1] === "members") return { kind: "person", id };
  return { kind: "org", id };
}

// Routes that get a kind-specific glyph but no entity fetch — their name comes
// from the label captured at visit time (recordRouteVisit refreshes it), which
// is accurate enough for offerings, notes, forms and hiring pages that rarely
// rename. Keeps the per-navigation resolver to three DB round trips.
type GlyphKind = Extract<FavoriteIconKind, "offering" | "note" | "form" | "hiring">;
function glyphKindForHref(href: string): GlyphKind | null {
  let path: string;
  try {
    path = new URL(href, "http://local").pathname;
  } catch {
    return null;
  }
  if (/^\/education\/[^/]+(\/hub)?$/.test(path)) return "offering";
  if (/^\/mentorship\/notes\/[^/]+$/.test(path)) return "note";
  if (/^\/forms\/[^/]+(\/[^/]+)?$/.test(path)) return "form";
  if (path.startsWith("/hiring/")) return "hiring";
  return null;
}

/**
 * Resolve route favorites/recents to their real entity icons in three batched
 * lookups. Non-entity hrefs (hubs, sub-tabs) map to a plain "route" kind so the
 * caller can fall back to the nav-area glyph.
 */
async function resolveRouteIcons(hrefs: string[]): Promise<Map<string, ResolvedRoute>> {
  const refByHref = new Map<string, RouteRef | null>();
  const projectIds = new Set<string>();
  const personIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const href of hrefs) {
    const ref = parseRouteHref(href);
    refByHref.set(href, ref);
    if (!ref) continue;
    if (ref.kind === "project") projectIds.add(ref.id);
    else if (ref.kind === "person") personIds.add(ref.id);
    else orgIds.add(ref.id);
  }

  const [projects, people, orgs] = await Promise.all([
    projectIds.size
      ? prisma.project.findMany({
          where: { id: { in: [...projectIds] } },
          select: { id: true, name: true, iconEmoji: true },
        })
      : [],
    personIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...personIds] } },
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        })
      : [],
    orgIds.size
      ? prisma.partnerOrg.findMany({
          where: { id: { in: [...orgIds] } },
          select: { id: true, name: true, logoUrl: true },
        })
      : [],
  ]);

  const projMap = new Map(projects.map((p) => [p.id, p]));
  const personMap = new Map(people.map((u) => [u.id, u]));
  const orgMap = new Map(orgs.map((o) => [o.id, o]));

  const out = new Map<string, ResolvedRoute>();
  for (const [href, ref] of refByHref) {
    if (!ref) {
      // Glyph-only kinds (offering/note/form/hiring) or a plain nav route.
      const iconKind = glyphKindForHref(href) ?? "route";
      out.set(href, { iconKind, title: null, iconEmoji: null, photoUrl: null, found: true });
    } else if (ref.kind === "project") {
      const p = projMap.get(ref.id);
      out.set(href, {
        iconKind: "project",
        title: p?.name ?? null,
        iconEmoji: p?.iconEmoji ?? null,
        photoUrl: null,
        found: !!p,
      });
    } else if (ref.kind === "person") {
      const u = personMap.get(ref.id);
      out.set(href, {
        iconKind: "person",
        title: u ? `${u.firstName} ${u.lastName}`.trim() : null,
        iconEmoji: null,
        photoUrl: u?.photoUrl ?? null,
        found: !!u,
      });
    } else {
      const o = orgMap.get(ref.id);
      out.set(href, {
        iconKind: "org",
        title: o?.name ?? null,
        iconEmoji: null,
        photoUrl: o?.logoUrl ?? null,
        found: !!o,
      });
    }
  }
  return out;
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
 * Note that this user just opened a detail route (project / person / partner
 * org). The route sibling of recordPageVisit — same fire-and-forget contract:
 * a failed bookkeeping write must never cost someone the page they asked for.
 * `label` is refreshed as a fallback name; the live entity name is preferred at
 * read time. Keyed on the (userId, href) unique so a repeat visit just bumps
 * the timestamp (leaving favoritedAt untouched if the route is also pinned).
 */
export function recordRouteVisit(userId: string, href: string, label: string): void {
  void prisma.userFavorite
    .upsert({
      where: { userId_href: { userId, href } },
      create: { userId, href, label, visitedAt: new Date() },
      update: { visitedAt: new Date(), label },
    })
    .catch((err) => {
      console.error("route visit write failed", {
        href,
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
