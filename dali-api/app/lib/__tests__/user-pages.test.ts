import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => {
  const getPageAccess = vi.fn();
  return {
    getPageAccess,
    // Delegates to the getPageAccess mock per page so existing per-page mock
    // setups drive the batched path unchanged.
    getPageAccessBulk: vi.fn(async (userId: string, pages: Array<{ id: string }>) => {
      const m = new Map();
      for (const p of pages) m.set(p.id, await getPageAccess(userId, p));
      return m;
    }),
  };
});

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  favoriteHrefs,
  listFavoritesAndRecents,
  setFavorite,
  setRouteFavorite,
} from "~/lib/user-pages.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockAccess = getPageAccess as unknown as ReturnType<typeof vi.fn>;

const USER = "user-1";

function page(id: string) {
  return { page: { id, title: id, iconEmoji: null, workspaceType: "Lab" } };
}

/**
 * Queue the four findMany calls in loader order: route favorites, page
 * favorites, page recents, then route recents. Recents carry a visitedAt so the
 * merge can order them; page recents get later timestamps than route recents so
 * the existing "keeps the query's order" expectations hold.
 */
function rows(
  favorites: string[],
  recents: string[],
  routes: { href: string; label: string }[] = [],
  routeRecents: { href: string; label: string }[] = [],
) {
  mockPrisma.userFavorite.findMany
    .mockResolvedValueOnce(routes)
    .mockResolvedValueOnce(favorites.map(page))
    .mockResolvedValueOnce(
      recents.map((id, i) => ({ ...page(id), visitedAt: new Date(2_000_000_000_000 - i) })),
    )
    .mockResolvedValueOnce(
      routeRecents.map((r, i) => ({ ...r, visitedAt: new Date(1_000_000_000_000 - i) })),
    );
}

const allowAll = () =>
  mockAccess.mockResolvedValue({ canView: true, canEdit: true, canComment: true, canResolve: true });

beforeEach(() => {
  vi.clearAllMocks();
  allowAll();
});

describe("listFavoritesAndRecents", () => {
  it("keeps the query's order — favorites and recents are already sorted", async () => {
    rows(["fav-1", "fav-2"], ["recent-1", "recent-2"]);
    const { favorites, recents } = await listFavoritesAndRecents(USER);
    expect(favorites.map((p) => p.id)).toEqual(["fav-1", "fav-2"]);
    expect(recents.map((p) => p.id)).toEqual(["recent-1", "recent-2"]);
  });

  it("marks favorites so the caller can tell the two lists apart", async () => {
    rows(["fav-1"], ["recent-1"]);
    const { favorites, recents } = await listFavoritesAndRecents(USER);
    expect(favorites[0].favorited).toBe(true);
    expect(recents[0].favorited).toBe(false);
  });

  it("asks the database to exclude favorites from recents, so no page is listed twice", async () => {
    rows(["fav-1"], []);
    await listFavoritesAndRecents(USER);
    const recentsQuery = mockPrisma.userFavorite.findMany.mock.calls[2][0];
    expect(recentsQuery.where.favoritedAt).toBeNull();
    expect(recentsQuery.where.visitedAt).toEqual({ not: null });
  });

  it("skips archived pages in both lists", async () => {
    rows([], []);
    await listFavoritesAndRecents(USER);
    // calls[0] (route favorites) and calls[3] (route recents) have no page
    // relation to filter — only the two page queries do.
    for (const call of mockPrisma.userFavorite.findMany.mock.calls.slice(1, 3)) {
      expect(call[0].where.page).toEqual({ is: { archivedAt: null } });
    }
  });

  it("caps recents at five even when more rows come back", async () => {
    rows([], ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents).toHaveLength(5);
  });

  it("drops pages the viewer can no longer open", async () => {
    rows([], ["visible", "revoked", "also-visible"]);
    mockAccess.mockImplementation(async (_user: string, p: { id: string }) => ({
      canView: p.id !== "revoked",
      canEdit: false,
      canComment: false,
      canResolve: false,
    }));
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents.map((p) => p.id)).toEqual(["visible", "also-visible"]);
  });

  it("still returns five when some rows fail the access check", async () => {
    // Over-reads exist precisely so a revoked page doesn't leave the panel short.
    rows([], ["bad", "r1", "r2", "bad", "r3", "r4", "r5", "r6"]);
    mockAccess.mockImplementation(async (_user: string, p: { id: string }) => ({
      canView: p.id !== "bad",
      canEdit: false,
      canComment: false,
      canResolve: false,
    }));
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents.map((p) => p.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });
});

describe("route favorites", () => {
  it("lists starred URLs alongside starred pages", async () => {
    rows(["fav-page"], [], [{ href: "/projects/p1", label: "Hood Museum AR" }]);
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites.map((f) => f.href)).toEqual(["/projects/p1", "/documents/fav-page"]);
  });

  it("resolves a favorited project route to its real icon and live name", async () => {
    rows([], [], [{ href: "/projects/p1", label: "stale label" }]);
    mockPrisma.project.findMany.mockResolvedValueOnce([
      { id: "p1", name: "Hood Museum AR", iconEmoji: "🏛️" },
    ]);
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites[0].iconKind).toBe("project");
    expect(favorites[0].iconEmoji).toBe("🏛️");
    expect(favorites[0].title).toBe("Hood Museum AR");
  });

  it("uses the stored label, since a route has no row to read a title from", async () => {
    rows([], [], [{ href: "/projects/p1?tab=board", label: "Tasks" }]);
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites[0].title).toBe("Tasks");
    expect(favorites[0].isRoute).toBe(true);
  });

  it("falls back to the href when no label was stored", async () => {
    rows([], [], [{ href: "/projects/p1", label: null as unknown as string }]);
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites[0].title).toBe("/projects/p1");
  });

  it("merges recently opened routes into recents alongside pages", async () => {
    // Page recents carry later timestamps (see rows helper), so they sort first.
    rows([], ["r1"], [], [{ href: "/projects/p1", label: "Hood Museum AR" }]);
    mockPrisma.project.findMany.mockResolvedValueOnce([
      { id: "p1", name: "Hood Museum AR", iconEmoji: null },
    ]);
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents.map((r) => r.href)).toEqual(["/documents/r1", "/projects/p1"]);
    expect(recents.find((r) => r.isRoute)?.title).toBe("Hood Museum AR");
  });

  it("drops a route recent whose entity no longer exists", async () => {
    rows([], [], [], [{ href: "/projects/gone", label: "Deleted" }]);
    // project.findMany defaults to [] — the entity resolves to not-found.
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents).toHaveLength(0);
  });

  it("gives offering/form/hiring/note recents a kind glyph and keeps the label", async () => {
    rows([], [], [], [
      { href: "/education/o1", label: "Intro to Design" },
      { href: "/education/o2/hub", label: "Studio" },
      { href: "/forms/f1", label: "Applications" },
      { href: "/forms/responses/f2", label: "Feedback responses" },
      { href: "/hiring/lead/cycle/c1", label: "26F Hiring" },
    ]);
    const { recents } = await listFavoritesAndRecents(USER);
    const kind = Object.fromEntries(recents.map((r) => [r.href, r.iconKind]));
    expect(kind["/education/o1"]).toBe("offering");
    expect(kind["/education/o2/hub"]).toBe("offering");
    expect(kind["/forms/f1"]).toBe("form");
    expect(kind["/forms/responses/f2"]).toBe("form");
    expect(kind["/hiring/lead/cycle/c1"]).toBe("hiring");
    expect(recents.find((r) => r.href === "/education/o1")?.title).toBe("Intro to Design");
  });

  it("queries unpinned route recents (favoritedAt null, href set)", async () => {
    rows([], [], [], [{ href: "/members/m1", label: "Ada" }]);
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    await listFavoritesAndRecents(USER);
    const routeRecentsQuery = mockPrisma.userFavorite.findMany.mock.calls[3][0];
    expect(routeRecentsQuery.where.favoritedAt).toBeNull();
    expect(routeRecentsQuery.where.visitedAt).toEqual({ not: null });
    expect(routeRecentsQuery.where.href).toEqual({ not: null });
  });

  it("drops navbar route favorites (home, settings, hub pages)", async () => {
    rows(
      [],
      [],
      [
        { href: "/", label: "Home" },
        { href: "/settings", label: "Settings" },
        { href: "/projects/p1", label: "Hood Museum AR" },
      ],
    );
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites.map((f) => f.href)).toEqual(["/projects/p1"]);
  });

  it("re-stars an existing row rather than creating a duplicate", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue({ id: "row-1" });
    await setRouteFavorite(USER, "/projects/p1", "Hood", true);
    expect(mockPrisma.userFavorite.create).not.toHaveBeenCalled();
    expect(mockPrisma.userFavorite.update.mock.calls[0][0].data.favoritedAt).toBeInstanceOf(Date);
  });

  it("refreshes the label on re-star, so a renamed destination catches up", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue({ id: "row-1" });
    await setRouteFavorite(USER, "/projects/p1", "New name", true);
    expect(mockPrisma.userFavorite.update.mock.calls[0][0].data.label).toBe("New name");
  });

  it("creates a row the first time a URL is starred", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue(null);
    await setRouteFavorite(USER, "/projects/p1", "Hood", true);
    expect(mockPrisma.userFavorite.create.mock.calls[0][0].data.href).toBe("/projects/p1");
  });

  it("stores a detail route by path, so its tab query can't star the same project twice", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue(null);
    await setRouteFavorite(USER, "/projects/p1?tab=progress&task=t9", "Hood", true);
    expect(mockPrisma.userFavorite.findFirst.mock.calls[0][0].where.href).toBe("/projects/p1");
    expect(mockPrisma.userFavorite.create.mock.calls[0][0].data.href).toBe("/projects/p1");
  });

  it("keeps a hub's query — there the filter is what's being pinned", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue(null);
    await setRouteFavorite(USER, "/education?term=25F", "25F courses", true);
    expect(mockPrisma.userFavorite.create.mock.calls[0][0].data.href).toBe("/education?term=25F");
    expect(mockPrisma.userFavorite.updateMany).not.toHaveBeenCalled();
  });

  it("clears rows starred from a tab before hrefs were canonicalized", async () => {
    mockPrisma.userFavorite.findFirst.mockResolvedValue({ id: "row-1" });
    await setRouteFavorite(USER, "/projects/p1", "Hood", false);
    const where = mockPrisma.userFavorite.updateMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { href: { startsWith: "/projects/p1?" } },
      { href: { startsWith: "/projects/p1#" } },
    ]);
    expect(mockPrisma.userFavorite.updateMany.mock.calls[0][0].data.favoritedAt).toBeNull();
  });

  it("reports a project starred from one tab as starred on every tab", async () => {
    mockPrisma.userFavorite.findMany.mockResolvedValueOnce([
      { href: "/projects/p1?tab=progress" },
      { href: "/education?term=25F" },
    ]);
    const hrefs = await favoriteHrefs(USER);
    expect(hrefs.has("/projects/p1")).toBe(true);
    expect(hrefs.has("/education?term=25F")).toBe(true);
  });

  it("lists a project once when old rows starred it under several tabs", async () => {
    rows(
      [],
      [],
      [
        { href: "/projects/p1?tab=progress", label: "Hood Museum AR" },
        { href: "/projects/p1?tab=team", label: "Hood Museum AR" },
        { href: "/projects/p1", label: "Hood Museum AR" },
      ],
    );
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites.map((f) => f.href)).toEqual(["/projects/p1"]);
  });
});

describe("setFavorite", () => {
  it("stamps a time when pinning", async () => {
    await setFavorite(USER, "page-1", true);
    const arg = mockPrisma.userFavorite.upsert.mock.calls[0][0];
    expect(arg.update.favoritedAt).toBeInstanceOf(Date);
    expect(arg.where).toEqual({ userId_pageId: { userId: USER, pageId: "page-1" } });
  });

  it("clears the time when unpinning, rather than deleting the row", async () => {
    // The row also carries visitedAt — dropping it would erase the visit.
    await setFavorite(USER, "page-1", false);
    const arg = mockPrisma.userFavorite.upsert.mock.calls[0][0];
    expect(arg.update.favoritedAt).toBeNull();
    expect(mockPrisma.userFavorite.delete).toBeUndefined();
  });
});
