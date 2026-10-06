import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { blogPost: { findMany: vi.fn(), findFirst: vi.fn() } },
}));
vi.mock("~/collab/blocknote-server", () => ({
  blocksToHtml: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { blocksToHtml } from "~/collab/blocknote-server";
import { getPublicBlog, listPublicBlogs } from "../public-blogs.server";

const mockPrisma = prisma as any;

const row = {
  id: "b1",
  title: "Hello",
  excerpt: "An opening.",
  summary: null,
  customCoverUrl: null,
  coverImageUrl: "/api/upload/raw?key=uploads%2Fdoc-images%2Fa.png",
  publishedAt: new Date("2026-10-01T12:00:00Z"),
  author: { firstName: "Ada", lastName: "Lovelace" },
};

beforeEach(() => vi.resetAllMocks());

describe("public blogs", () => {
  it("only ever queries published Public posts", async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([]);
    mockPrisma.blogPost.findFirst.mockResolvedValue(null);
    await listPublicBlogs();
    expect(await getPublicBlog("b1")).toBeNull();
    for (const call of [
      mockPrisma.blogPost.findMany.mock.calls[0][0],
      mockPrisma.blogPost.findFirst.mock.calls[0][0],
    ]) {
      expect(call.where).toMatchObject({ visibility: "Public", publishedAt: { not: null } });
    }
  });

  it("serves cover and body images through the media proxy path", async () => {
    mockPrisma.blogPost.findMany.mockResolvedValue([row]);
    mockPrisma.blogPost.findFirst.mockResolvedValue({ ...row, contentJson: [] });
    (blocksToHtml as any).mockResolvedValue(
      '<img src="/api/upload/raw?key=uploads%2Fdoc-images%2Fa.png">',
    );

    const [blog] = await listPublicBlogs();
    expect(blog).toEqual({
      id: "b1",
      title: "Hello",
      excerpt: "An opening.",
      coverImage: "/api/media?key=uploads%2Fdoc-images%2Fa.png",
      author: "Ada Lovelace",
      publishedAt: "2026-10-01T12:00:00.000Z",
    });
    const detail = await getPublicBlog("b1");
    expect(detail?.bodyHtml).toBe('<img src="/api/media?key=uploads%2Fdoc-images%2Fa.png">');
  });
});
