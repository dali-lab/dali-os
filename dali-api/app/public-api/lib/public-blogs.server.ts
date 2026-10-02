import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { blocksToHtml, type DocBlock } from "~/collab/blocknote-server";
import { blogListing } from "~/lib/blog-preview";
import { publicizeUploadUrls } from "./public-media";

export type PublicBlog = {
  id: string;
  title: string;
  excerpt: string;
  coverImage: string;
  author: string;
  publishedAt: string;
};

// Only posts their author both published and marked Public. Internal posts and
// drafts are indistinguishable from missing ones here.
const PUBLIC = { visibility: "Public", publishedAt: { not: null } } as const;

const BLOG_SELECT = {
  id: true,
  title: true,
  excerpt: true,
  summary: true,
  coverImageUrl: true,
  customCoverUrl: true,
  publishedAt: true,
  author: { select: { firstName: true, lastName: true } },
} as const;

type BlogRow = {
  id: string;
  title: string;
  excerpt: string;
  summary: string | null;
  coverImageUrl: string | null;
  customCoverUrl: string | null;
  publishedAt: Date | null;
  author: { firstName: string | null; lastName: string | null };
};

function toPublicBlog(row: BlogRow): PublicBlog {
  const { excerpt, coverImageUrl } = blogListing(row);
  return {
    id: row.id,
    title: row.title,
    excerpt,
    coverImage: coverImageUrl ? publicizeUploadUrls(coverImageUrl) : "",
    author: fullName(row.author),
    publishedAt: row.publishedAt!.toISOString(),
  };
}

export async function listPublicBlogs(): Promise<PublicBlog[]> {
  const rows = await prisma.blogPost.findMany({
    where: PUBLIC,
    orderBy: { publishedAt: "desc" },
    select: BLOG_SELECT,
  });
  return rows.map(toPublicBlog);
}

export async function getPublicBlog(
  id: string,
): Promise<{ blog: PublicBlog; bodyHtml: string } | null> {
  const row = await prisma.blogPost.findFirst({
    where: { id, ...PUBLIC },
    select: { ...BLOG_SELECT, contentJson: true },
  });
  if (!row) return null;
  const blocks = (Array.isArray(row.contentJson) ? row.contentJson : []) as unknown as DocBlock[];
  return {
    blog: toPublicBlog(row),
    bodyHtml: publicizeUploadUrls(await blocksToHtml(blocks)),
  };
}
