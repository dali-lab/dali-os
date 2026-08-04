import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { listFavoritesAndRecents, setFavorite } from "~/lib/user-pages.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockAccess = getPageAccess as unknown as ReturnType<typeof vi.fn>;

const USER = "user-1";

function page(id: string) {
  return { page: { id, title: id, iconEmoji: null, workspaceType: "Lab" } };
}

/** Queue the two findMany calls: favourites first, then recents. */
function rows(favorites: string[], recents: string[]) {
  mockPrisma.userPage.findMany
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
    const recentsQuery = mockPrisma.userPage.findMany.mock.calls[1][0];
    expect(recentsQuery.where.favoritedAt).toBeNull();
    expect(recentsQuery.where.visitedAt).toEqual({ not: null });
  });

  it("skips archived pages in both lists", async () => {
    rows([], []);
    await listFavoritesAndRecents(USER);
    for (const call of mockPrisma.userPage.findMany.mock.calls) {
      expect(call[0].where.page).toEqual({ archivedAt: null });
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

describe("setFavorite", () => {
  it("stamps a time when pinning", async () => {
    await setFavorite(USER, "page-1", true);
    const arg = mockPrisma.userPage.upsert.mock.calls[0][0];
    expect(arg.update.favoritedAt).toBeInstanceOf(Date);
    expect(arg.where).toEqual({ userId_pageId: { userId: USER, pageId: "page-1" } });
  });

  it("clears the time when unpinning, rather than deleting the row", async () => {
    // The row also carries visitedAt — dropping it would erase the visit.
    await setFavorite(USER, "page-1", false);
    const arg = mockPrisma.userPage.upsert.mock.calls[0][0];
    expect(arg.update.favoritedAt).toBeNull();
    expect(mockPrisma.userPage.delete).toBeUndefined();
  });
});
