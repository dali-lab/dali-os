import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { blogPost: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/resources.server", () => ({ resourcesAccess: vi.fn() }));
vi.mock("~/lib/blog-post.server", async (orig) => {
  const real = await orig<typeof import("~/lib/blog-post.server")>();
  return {
    ...real,
    findBlogPost: vi.fn(),
    publishBlogPost: vi.fn(),
    unpublishBlogPost: vi.fn(),
  };
});
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({ adminRecipientIds: vi.fn() }));
vi.mock("~/collab/blocknote-server", () => ({
  blocksToMarkdown: vi.fn(),
  markdownToBlocks: vi.fn(),
}));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));
vi.mock("../../set-page-content", () => ({ MAX_MARKDOWN_LENGTH: 300_000 }));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { resourcesAccess } from "~/lib/resources.server";
import { findBlogPost, publishBlogPost, unpublishBlogPost } from "~/lib/blog-post.server";
import { blocksToMarkdown, markdownToBlocks } from "~/collab/blocknote-server";
import { replaceCollabDocContent } from "~/collab/write";
import {
  LIST_BLOG_POSTS_TOOL,
  READ_BLOG_POST_TOOL,
  MANAGE_BLOG_POST_TOOL,
  runListBlogPosts,
  runReadBlogPost,
  runManageBlogPost,
} from "~/mcp/tools/docs/blog-posts";

const db = prisma as any;
const BLOCKS = [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }];

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    title: "Hello",
    summary: null,
    excerpt: "From the body",
    customCoverUrl: null,
    coverImageUrl: null,
    contentJson: BLOCKS,
    visibility: "Internal",
    publishedAt: null,
    submittedAt: null,
    authorId: "me",
    author: { firstName: "Sam", lastName: "Lee" },
    ...over,
  };
}

function found(over: Record<string, unknown> = {}, access: Record<string, unknown> = {}) {
  vi.mocked(findBlogPost).mockResolvedValue({
    post: post(over),
    canEdit: true,
    canApprove: false,
    ...access,
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resourcesAccess).mockResolvedValue({ core: false });
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(markdownToBlocks).mockResolvedValue(BLOCKS as any);
  vi.mocked(blocksToMarkdown).mockResolvedValue("Hi");
});

describe("scopes", () => {
  it("reads need mcp:read, writes need mcp:write", () => {
    expect(LIST_BLOG_POSTS_TOOL.requiredScope).toBe("mcp:read");
    expect(READ_BLOG_POST_TOOL.requiredScope).toBe("mcp:read");
    expect(MANAGE_BLOG_POST_TOOL.requiredScope).toBe("mcp:write");
  });
});

describe("the Resources gate", () => {
  it("refuses every tool to a caller without Resources access", async () => {
    vi.mocked(resourcesAccess).mockResolvedValue(null);
    await expect(runListBlogPosts("me", {})).rejects.toMatchObject({ status: 403 });
    await expect(runReadBlogPost("me", { postId: "p1" })).rejects.toMatchObject({ status: 403 });
    await expect(
      runManageBlogPost("me", { action: "create", title: "Hello" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.blogPost.findMany).not.toHaveBeenCalled();
    expect(db.blogPost.create).not.toHaveBeenCalled();
  });
});

describe("list_blog_posts", () => {
  it("lists what the front page would, with the author's summary over the excerpt", async () => {
    db.blogPost.findMany.mockResolvedValue([
      post({ id: "pub", publishedAt: new Date("2026-10-01T00:00:00Z"), authorId: "other", summary: "Picked" }),
      post({ id: "mine" }),
    ]);
    const res = await runListBlogPosts("me", {});
    expect(db.blogPost.findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([{ publishedAt: { not: null } }]),
    );
    expect(res.posts).toEqual([
      expect.objectContaining({ id: "pub", status: "published", mine: false, excerpt: "Picked", author: "Sam Lee" }),
      expect.objectContaining({ id: "mine", status: "draft", mine: true, excerpt: "From the body" }),
    ]);
  });

  it("only an Admin is listed posts waiting for approval", async () => {
    db.blogPost.findMany.mockResolvedValue([]);
    await runListBlogPosts("me", {});
    expect(db.blogPost.findMany.mock.calls[0][0].where.OR).not.toContainEqual({ submittedAt: { not: null } });

    vi.mocked(isAdmin).mockResolvedValue(true);
    await runListBlogPosts("me", {});
    expect(db.blogPost.findMany.mock.calls[1][0].where.OR).toContainEqual({ submittedAt: { not: null } });
  });

  it("filters by status", async () => {
    db.blogPost.findMany.mockResolvedValue([post({ id: "a", publishedAt: new Date() }), post({ id: "b" })]);
    const res = await runListBlogPosts("me", { status: "draft" });
    expect(res.posts.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("read_blog_post", () => {
  it("returns the body as Markdown", async () => {
    found();
    const res = await runReadBlogPost("me", { postId: "p1" });
    expect(blocksToMarkdown).toHaveBeenCalledWith(BLOCKS);
    expect(res).toMatchObject({ id: "p1", status: "draft", canEdit: true, markdown: "Hi" });
  });

  it("is not found when the caller can't see the post", async () => {
    vi.mocked(findBlogPost).mockResolvedValue(null);
    await expect(runReadBlogPost("me", { postId: "p1" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("manage_blog_post", () => {
  it("create makes the caller's draft and writes the body through the collab room", async () => {
    db.blogPost.create.mockResolvedValue({ id: "new" });
    const res = await runManageBlogPost("me", {
      action: "create",
      title: "  My   post ",
      summary: " ",
      isPublic: true,
      markdown: "Hi",
    });
    expect(db.blogPost.create).toHaveBeenCalledWith({
      data: { title: "My post", summary: null, visibility: "Public", authorId: "me" },
      select: { id: true },
    });
    expect(replaceCollabDocContent).toHaveBeenCalledWith("blogPost:new:body", BLOCKS, "me");
    expect(res).toEqual({ id: "new", status: "draft" });
  });

  it("create needs a title", async () => {
    await expect(runManageBlogPost("me", { action: "create" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageBlogPost("me", { action: "create", title: "  " })).rejects.toMatchObject({ status: 400 });
    expect(db.blogPost.create).not.toHaveBeenCalled();
  });

  it("bad Markdown changes nothing", async () => {
    found();
    vi.mocked(markdownToBlocks).mockRejectedValue(new Error("boom"));
    await expect(
      runManageBlogPost("me", { action: "update", postId: "p1", title: "New", markdown: "x" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.blogPost.update).not.toHaveBeenCalled();
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
  });

  it("update refuses a reader who can't edit the post", async () => {
    found({ publishedAt: new Date(), authorId: "other" }, { canEdit: false });
    await expect(
      runManageBlogPost("me", { action: "update", postId: "p1", title: "Mine now" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.blogPost.update).not.toHaveBeenCalled();
  });

  it("update saves details and replaces the body", async () => {
    found();
    await runManageBlogPost("me", { action: "update", postId: "p1", title: "New", markdown: "Hi" });
    expect(db.blogPost.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { title: "New" } });
    expect(replaceCollabDocContent).toHaveBeenCalledWith("blogPost:p1:body", BLOCKS, "me");
  });

  it("an author can't change the audience once the post has left draft, an Admin can", async () => {
    found({ submittedAt: new Date() });
    await expect(
      runManageBlogPost("me", { action: "update", postId: "p1", isPublic: true }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.blogPost.update).not.toHaveBeenCalled();

    found({ submittedAt: new Date() }, { canApprove: true });
    await runManageBlogPost("me", { action: "update", postId: "p1", isPublic: true });
    expect(db.blogPost.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { visibility: "Public" } });
  });

  it("publish reports where the post landed", async () => {
    found();
    vi.mocked(publishBlogPost).mockResolvedValue("review");
    const res = await runManageBlogPost("me", { action: "publish", postId: "p1" });
    expect(publishBlogPost).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), {
      id: "me",
      canApprove: false,
    });
    expect(res).toEqual({ id: "p1", status: "review" });
  });

  it("unpublish returns the post to a draft", async () => {
    found({ publishedAt: new Date() });
    const res = await runManageBlogPost("me", { action: "unpublish", postId: "p1" });
    expect(unpublishBlogPost).toHaveBeenCalledWith("p1");
    expect(res).toEqual({ id: "p1", status: "draft" });
  });
});
