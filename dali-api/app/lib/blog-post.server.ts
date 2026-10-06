import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import { requireResourcesViewer } from "~/lib/resources.server";

// One post, as its read page and its write page both load it. A draft is its
// author's (and Core's) alone; to anyone else it doesn't exist.
export async function loadBlogPost(request: Request, postId: string) {
  const viewer = await requireResourcesViewer(request);
  const post = await prisma.blogPost.findUnique({
    where: { id: postId },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
  const canEdit = !!post && (post.authorId === viewer.user.sub || viewer.core);
  if (!post || (!post.publishedAt && !canEdit)) {
    throw new Response("Not found", { status: 404 });
  }
  return { viewer, post, canEdit };
}

// A draft nobody wrote anything in: still "Untitled", with no body text, image
// or settings. Write reuses one instead of piling up empties, and the front
// page leaves it out of "Your drafts".
export const UNTOUCHED_DRAFT = {
  title: "Untitled",
  excerpt: "",
  coverImageUrl: null,
  customCoverUrl: null,
  summary: null,
  publishedAt: null,
} as const;

// ─── Pinning ─────────────────────────────────────────────────────────────────
// Pinned posts (frontPageRank set) lead The Scoop, lowest rank first; the rest
// follow newest first. Only a published post holds a pin. Every change is
// worked out here from the stored order, never from what a browser last saw.

/** Pin a post to the very top: ahead of everything already pinned. */
export async function pinBlogPostToTop(postId: string): Promise<void> {
  const first = await prisma.blogPost.aggregate({ _min: { frontPageRank: true } });
  await prisma.blogPost.updateMany({
    where: { id: postId, publishedAt: { not: null } },
    data: { frontPageRank: (first._min.frontPageRank ?? 0) - 1 },
  });
}

export async function unpinBlogPost(postId: string): Promise<void> {
  await prisma.blogPost.updateMany({ where: { id: postId }, data: { frontPageRank: null } });
}

/** Swap a pinned post with its pinned neighbour. A no-op at either end. */
export async function moveBlogPostPin(postId: string, by: -1 | 1): Promise<void> {
  const pinned = await prisma.blogPost.findMany({
    where: { frontPageRank: { not: null } },
    orderBy: { frontPageRank: "asc" },
    select: { id: true, frontPageRank: true },
  });
  const from = pinned.findIndex((p) => p.id === postId);
  const other = pinned[from + by];
  if (from === -1 || !other) return;
  const swap = (id: string, frontPageRank: number | null): Prisma.PrismaPromise<unknown> =>
    prisma.blogPost.update({ where: { id }, data: { frontPageRank } });
  await prisma.$transaction([
    swap(postId, other.frontPageRank),
    swap(other.id, pinned[from]!.frontPageRank),
  ]);
}
