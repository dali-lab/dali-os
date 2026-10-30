import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    blogPost: {
      aggregate: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/resources.server", () => ({ requireResourcesViewer: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({ adminRecipientIds: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { adminRecipientIds } from "~/lib/promotion-notify.server";
import {
  BLOG_FEED_PAGE_SIZE,
  findBlogPost,
  loadBlogFeedPage,
  loadBlogFrontPage,
  moveBlogPostPin,
  pinBlogPostToTop,
  publishBlogPost,
  unpublishBlogPost,
} from "../blog-post.server";

const db = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  db.blogPost.update.mockImplementation((args: unknown) => args);
});

describe("findBlogPost", () => {
  const reader = { id: "reader", core: false };

  it("hides a draft from everyone but its author and Core", async () => {
    db.blogPost.findUnique.mockResolvedValue({ id: "p1", authorId: "author", publishedAt: null });
    expect(await findBlogPost(reader, "p1")).toBeNull();
    expect(await findBlogPost({ id: "author", core: false }, "p1")).toMatchObject({ canEdit: true });
    expect(await findBlogPost({ id: "reader", core: true }, "p1")).toMatchObject({ canEdit: true });
  });

  it("lets anyone read a published post, but not edit it", async () => {
    db.blogPost.findUnique.mockResolvedValue({ id: "p1", authorId: "author", publishedAt: new Date() });
    expect(await findBlogPost(reader, "p1")).toMatchObject({ canEdit: false });
  });
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

describe("review", () => {
  const draft = {
    id: "p1",
    title: "Demo night",
    authorId: "author",
    publishedAt: null,
    submittedAt: null,
    author: { firstName: "Ada", lastName: "Lovelace" },
  };

  it("sends a member's post to the admins instead of publishing it", async () => {
    vi.mocked(adminRecipientIds).mockResolvedValue(["admin1", "admin2"]);
    expect(await publishBlogPost(draft, { id: "author", canApprove: false })).toBe("review");
    expect(db.blogPost.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { submittedAt: expect.any(Date) },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "blog.submitted",
        message: {
          vars: { personName: "Ada Lovelace", itemTitle: "Demo night" },
          link: "/resources/blog/p1",
        },
        recipients: [{ userId: "admin1" }, { userId: "admin2" }],
      }),
    );
  });

  it("does not notify the admins twice for a post already in review", async () => {
    const status = await publishBlogPost(
      { ...draft, submittedAt: new Date() },
      { id: "author", canApprove: false },
    );
    expect(status).toBe("review");
    expect(db.blogPost.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("publishes on an admin's approval and tells the author", async () => {
    const status = await publishBlogPost(
      { ...draft, submittedAt: new Date() },
      { id: "admin1", canApprove: true },
    );
    expect(status).toBe("published");
    expect(db.blogPost.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { publishedAt: expect.any(Date), submittedAt: null },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "blog.approved", recipients: [{ userId: "author" }] }),
    );
  });

  it("publishes an admin's own post without a notification", async () => {
    expect(await publishBlogPost(draft, { id: "author", canApprove: true })).toBe("published");
    expect(notify).not.toHaveBeenCalled();
  });

  it("clears the review and the pin when a post goes back to a draft", async () => {
    await unpublishBlogPost("p1");
    expect(db.blogPost.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { publishedAt: null, submittedAt: null, frontPageRank: null },
    });
  });
});

describe("the front page feed", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Post ${id}`,
    excerpt: "",
    summary: null,
    coverImageUrl: null,
    customCoverUrl: null,
    visibility: "Private",
    publishedAt: new Date("2026-10-01T12:00:00Z"),
    submittedAt: null,
    frontPageRank: null,
    authorId: "author",
    author: { firstName: "Ada", lastName: "Tester" },
    ...extra,
  });

  it("pages only unpinned published posts on (publishedAt, id) with one extra row to find the end", async () => {
    db.blogPost.findMany.mockResolvedValue([]);
    await loadBlogFeedPage("viewer", null);
    expect(db.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publishedAt: { not: null }, frontPageRank: null },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: BLOG_FEED_PAGE_SIZE + 1,
      }),
    );
  });

  it("continues strictly after the cursor and hands back the next one when more remain", async () => {
    const rows = Array.from({ length: BLOG_FEED_PAGE_SIZE + 1 }, (_, i) =>
      row(`p${i}`, { publishedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 59 - i)) }),
    );
    db.blogPost.findMany.mockResolvedValue(rows);
    const page = await loadBlogFeedPage("viewer", "2026-10-02T00:00:00.000Z|p99");
    const where = db.blogPost.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { publishedAt: { lt: new Date("2026-10-02T00:00:00.000Z") } },
      { publishedAt: new Date("2026-10-02T00:00:00.000Z"), id: { lt: "p99" } },
    ]);
    expect(page.items).toHaveLength(BLOG_FEED_PAGE_SIZE);
    expect(page.nextCursor).toBe(`${rows[BLOG_FEED_PAGE_SIZE - 1].publishedAt.toISOString()}|p${BLOG_FEED_PAGE_SIZE - 1}`);
  });

  it("ends the feed on a short page", async () => {
    db.blogPost.findMany.mockResolvedValue([row("p1")]);
    expect(await loadBlogFeedPage("viewer", null)).toMatchObject({ nextCursor: null });
  });

  it("marks the viewer's own posts and the pinned ones", async () => {
    db.blogPost.findMany.mockResolvedValue([row("p1", { authorId: "viewer" })]);
    const { items } = await loadBlogFeedPage("viewer", null);
    expect(items[0]).toMatchObject({ id: "p1", mine: true, pinned: false, status: "published", author: "Ada Tester" });
  });

  it("lists every pinned post first, then the first feed page, and keeps drafts and review items whole", async () => {
    const pinned = [row("pin1", { frontPageRank: 1 }), row("pin2", { frontPageRank: 2 })];
    const unpublished = [
      row("review1", { publishedAt: null, submittedAt: new Date(), authorId: "someone" }),
      row("mine-review", { publishedAt: null, submittedAt: new Date(), authorId: "viewer" }),
      row("draft1", { publishedAt: null, authorId: "viewer" }),
    ];
    db.blogPost.findMany.mockImplementation(async (args: any) => {
      if (args.where.frontPageRank?.not === null) return pinned;
      if (args.where.publishedAt === null) return unpublished;
      return [row("feed1")];
    });
    const page = await loadBlogFrontPage("viewer", true);
    expect(page.published.map((p) => p.id)).toEqual(["pin1", "pin2", "feed1"]);
    expect(page.toReview.map((p) => p.id)).toEqual(["review1"]);
    expect(page.drafts.map((p) => p.id)).toEqual(["mine-review", "draft1"]);
    expect(page.nextCursor).toBeNull();
    const unpublishedQuery = db.blogPost.findMany.mock.calls.map((c: any) => c[0]).find((a: any) => a.where.publishedAt === null);
    expect(unpublishedQuery.where.OR).toEqual([
      { publishedAt: { not: null } },
      { authorId: "viewer", NOT: expect.anything() },
      { submittedAt: { not: null } },
    ]);
  });

  it("does not ask for posts waiting on approval when the viewer is not an Admin", async () => {
    db.blogPost.findMany.mockResolvedValue([]);
    await loadBlogFrontPage("viewer", false);
    const unpublishedQuery = db.blogPost.findMany.mock.calls.map((c: any) => c[0]).find((a: any) => a.where.publishedAt === null);
    expect(unpublishedQuery.where.OR).not.toContainEqual({ submittedAt: { not: null } });
  });
});
