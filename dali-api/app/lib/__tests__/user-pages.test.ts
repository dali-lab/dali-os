import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { listFavoritesAndRecents, setFavorite, setRouteFavorite } from "~/lib/user-pages.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockAccess = getPageAccess as unknown as ReturnType<typeof vi.fn>;

const USER = "user-1";

function page(id: string) {
  return { page: { id, title: id, iconEmoji: null, workspaceType: "Lab" } };
}

/** Queue the three findMany calls: route favourites, then pages, then recents. */
function rows(favorites: string[], recents: string[], routes: { href: string; label: string }[] = []) {
  mockPrisma.userFavorite.findMany
    .mockResolvedValueOnce(routes)
    .mockResolvedValueOnce(favorites.map(page))
    .mockResolvedValueOnce(recents.map(page));
}

const allowAll = () =>
  mockAccess.mockResolvedValue({ canView: true, canEdit: true, canComment: true, canResolve: true });

beforeEach(() => {
  vi.clearAllMocks();
  allowAll();
});

describe("listFavoritesAndRecents", () => {
  it("keeps the query's order — favourites and recents are already sorted", async () => {
    rows(["fav-1", "fav-2"], ["recent-1", "recent-2"]);
    const { favorites, recents } = await listFavoritesAndRecents(USER);
    expect(favorites.map((p) => p.id)).toEqual(["fav-1", "fav-2"]);
    expect(recents.map((p) => p.id)).toEqual(["recent-1", "recent-2"]);
  });

  it("marks favourites so the caller can tell the two lists apart", async () => {
    rows(["fav-1"], ["recent-1"]);
    const { favorites, recents } = await listFavoritesAndRecents(USER);
    expect(favorites[0].favorited).toBe(true);
    expect(recents[0].favorited).toBe(false);
  });

  it("asks the database to exclude favourites from recents, so no page is listed twice", async () => {
    rows(["fav-1"], []);
    await listFavoritesAndRecents(USER);
    const recentsQuery = mockPrisma.userFavorite.findMany.mock.calls[2][0];
    expect(recentsQuery.where.favoritedAt).toBeNull();
    expect(recentsQuery.where.visitedAt).toEqual({ not: null });
  });

  it("skips archived pages in both lists", async () => {
    rows([], []);
    await listFavoritesAndRecents(USER);
    // calls[0] is the route query, which has no page relation to filter.
    for (const call of mockPrisma.userFavorite.findMany.mock.calls.slice(1)) {
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

describe("route favourites", () => {
  it("lists starred URLs alongside starred pages", async () => {
    rows(["fav-page"], [], [{ href: "/projects/p1", label: "Hood Museum AR" }]);
    const { favorites } = await listFavoritesAndRecents(USER);
    expect(favorites.map((f) => f.href)).toEqual(["/projects/p1", "/documents/fav-page"]);
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

  it("never puts a route in recents — those are documents you opened", async () => {
    rows([], ["r1"], [{ href: "/projects/p1", label: "P" }]);
    const { recents } = await listFavoritesAndRecents(USER);
    expect(recents.every((r) => !r.isRoute)).toBe(true);
  });

  it("drops navbar route favourites (home, settings, hub pages)", async () => {
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
