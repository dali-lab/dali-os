import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { feedbackPost: { findMany: vi.fn() } } }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => (u ? `signed:${u}` : null)) }));

import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { encodeCursor } from "~/lib/pagination";
import { FEED_PAGE_SIZE, loadFeedbackPage, loadFeedbackPostsByIds } from "~/lib/feedback-feed.server";

const findMany = vi.mocked(prisma.feedbackPost.findMany);
const viewer = { userId: "ada", core: false };

function post(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    body: `body ${id}`,
    screenshotKey: null,
    pagePath: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    author: { id: "ada", firstName: "Ada", lastName: "Lovelace", photoUrl: "ada.png" },
    reactions: [],
    comments: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([] as never);
});

describe("loadFeedbackPage", () => {
  it("reads one past the page size, orders by createdAt then id, and has no where on the first page", async () => {
    await loadFeedbackPage(null, viewer);
    const args = findMany.mock.calls[0][0]!;
    expect(args.take).toBe(FEED_PAGE_SIZE + 1);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.where).toEqual({});
  });

  it("returns a cursor from the last row only when another page exists", async () => {
    const rows = Array.from({ length: FEED_PAGE_SIZE + 1 }, (_, i) => post(`p${i}`));
    findMany.mockResolvedValue(rows as never);
    const page = await loadFeedbackPage(null, viewer);
    expect(page.items).toHaveLength(FEED_PAGE_SIZE);
    expect(page.nextCursor).toBe(encodeCursor({ at: "2026-03-01T00:00:00.000Z", id: `p${FEED_PAGE_SIZE - 1}` }));

    findMany.mockResolvedValue([post("only")] as never);
    expect((await loadFeedbackPage(null, viewer)).nextCursor).toBeNull();
  });

  it("applies the keyset where for a later page and ignores a malformed cursor", async () => {
    await loadFeedbackPage("2026-02-01T00:00:00.000Z|p9", viewer);
    expect(findMany.mock.calls[0][0]!.where).toEqual({
      OR: [
        { createdAt: { lt: new Date("2026-02-01T00:00:00.000Z") } },
        { createdAt: new Date("2026-02-01T00:00:00.000Z"), id: { lt: "p9" } },
      ],
    });
    await loadFeedbackPage("garbage", viewer);
    expect(findMany.mock.calls[1][0]!.where).toEqual({});
  });

  it("presigns each author once on every page and marks what the viewer may delete", async () => {
    findMany.mockResolvedValue([
      post("p1", {
        comments: [
          {
            id: "c1",
            body: "hi",
            createdAt: new Date("2026-03-02T00:00:00Z"),
            author: { id: "grace", firstName: "Grace", lastName: "Hopper", photoUrl: "grace.png" },
          },
        ],
      }),
      post("p2"),
    ] as never);
    const page = await loadFeedbackPage("2026-02-01T00:00:00.000Z|p9", viewer);
    expect(vi.mocked(resolvePhotoUrl).mock.calls.map((c) => c[0]).sort()).toEqual(["ada.png", "grace.png"]);
    expect(page.items[0].author).toEqual({ id: "ada", name: "Ada Lovelace", photoUrl: "signed:ada.png" });
    expect(page.items[0].canDelete).toBe(true);
    expect(page.items[0].comments[0]).toMatchObject({ canDelete: false, author: { photoUrl: "signed:grace.png" } });
  });

  it("lets Core delete anything", async () => {
    findMany.mockResolvedValue([post("p1", { author: { id: "x", firstName: "X", lastName: "Y", photoUrl: null } })] as never);
    const page = await loadFeedbackPage(null, { userId: "ada", core: true });
    expect(page.items[0].canDelete).toBe(true);
  });
});

describe("loadFeedbackPostsByIds", () => {
  it("returns nothing without querying for an empty list", async () => {
    expect(await loadFeedbackPostsByIds([], viewer)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("dedupes and caps the ids, and shapes posts for the viewer", async () => {
    findMany.mockResolvedValue([post("p1")] as never);
    const ids = Array.from({ length: 80 }, (_, i) => `p${i % 70}`);
    const posts = await loadFeedbackPostsByIds(ids, viewer);
    const where = findMany.mock.calls[0][0]!.where as { id: { in: string[] } };
    expect(where.id.in).toHaveLength(50);
    expect(new Set(where.id.in).size).toBe(50);
    expect(posts[0]).toMatchObject({ id: "p1", canDelete: true });
  });
});
