import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    blogPost: { aggregate: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/resources.server", () => ({ requireResourcesViewer: vi.fn() }));

import { prisma } from "~/lib/db";
import { moveBlogPostPin, pinBlogPostToTop } from "../blog-post.server";

const db = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  db.blogPost.update.mockImplementation((args: unknown) => args);
});

describe("pinning", () => {
  it("pins ahead of everything already pinned, and only a published post", async () => {
    db.blogPost.aggregate.mockResolvedValue({ _min: { frontPageRank: 2 } });
    await pinBlogPostToTop("p1");
    expect(db.blogPost.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", publishedAt: { not: null } },
      data: { frontPageRank: 1 },
    });
  });

  it("swaps ranks with the pinned neighbour", async () => {
    db.blogPost.findMany.mockResolvedValue([
      { id: "a", frontPageRank: -1 },
      { id: "b", frontPageRank: 0 },
      { id: "c", frontPageRank: 4 },
    ]);
    await moveBlogPostPin("b", 1);
    expect(db.$transaction).toHaveBeenCalledWith([
      { where: { id: "b" }, data: { frontPageRank: 4 } },
      { where: { id: "c" }, data: { frontPageRank: 0 } },
    ]);
  });

  it("does nothing at the end of the pinned run or for an unpinned post", async () => {
    db.blogPost.findMany.mockResolvedValue([{ id: "a", frontPageRank: 0 }]);
    await moveBlogPostPin("a", -1);
    await moveBlogPostPin("zzz", 1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
