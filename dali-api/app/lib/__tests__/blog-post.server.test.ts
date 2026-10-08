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
  findBlogPost,
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
