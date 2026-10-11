import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import { requireResourcesViewer } from "~/lib/resources.server";
import { isAdmin } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { notify } from "~/lib/notify.server";
import { adminRecipientIds } from "~/lib/promotion-notify.server";

// One post, as its read page and its write page both load it. A draft is its
// author's (and Core's) alone; to anyone else it doesn't exist. Only an Admin
// publishes: anyone else's post waits in review until one approves it.
export async function findBlogPost(viewer: { id: string; core: boolean }, postId: string) {
  const post = await prisma.blogPost.findUnique({
    where: { id: postId },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
  const canEdit = !!post && (post.authorId === viewer.id || viewer.core);
  if (!post || (!post.publishedAt && !canEdit)) return null;
  return { post, canEdit, canApprove: await isAdmin(viewer.id) };
}

export async function loadBlogPost(request: Request, postId: string) {
  const viewer = await requireResourcesViewer(request);
  const found = await findBlogPost({ id: viewer.user.sub, core: viewer.core }, postId);
  if (!found) throw new Response("Not found", { status: 404 });
  return { viewer, ...found };
}

// What the front page lists for one viewer: everything published, their own
// drafts, and for an Admin everything waiting on approval.
export function listedBlogPostsWhere(userId: string, canApprove: boolean): Prisma.BlogPostWhereInput {
  return {
    OR: [
      { publishedAt: { not: null } },
      { authorId: userId, NOT: UNTOUCHED_DRAFT },
      ...(canApprove ? [{ submittedAt: { not: null } }] : []),
    ],
  };
}

export const BLOG_LISTING_ORDER: Prisma.BlogPostOrderByWithRelationInput[] = [
  { frontPageRank: { sort: "asc", nulls: "last" } },
  { publishedAt: "desc" },
  { updatedAt: "desc" },
];

export type BlogStatus = "published" | "review" | "draft";

export function blogStatus(post: { publishedAt: Date | null; submittedAt: Date | null }): BlogStatus {
  if (post.publishedAt) return "published";
  return post.submittedAt ? "review" : "draft";
}

// An Admin approves a post for an audience; its author can't widen that after.
export function canChangeBlogAudience(
  post: { publishedAt: Date | null; submittedAt: Date | null },
  canApprove: boolean,
): boolean {
  return canApprove || blogStatus(post) === "draft";
}

type ReviewPost = {
  id: string;
  title: string;
  authorId: string;
  publishedAt: Date | null;
  submittedAt: Date | null;
  author: { firstName: string | null; lastName: string | null };
};

/**
 * The Publish button, whoever presses it. An Admin's press publishes (which is
 * also how a post in review gets approved); anyone else's sends the draft to
 * the Admins. Returns where the post landed.
 */
export async function publishBlogPost(
  post: ReviewPost,
  actor: { id: string; canApprove: boolean },
): Promise<BlogStatus> {
  if (post.publishedAt) return "published";
  const where = { id: post.id };
  const link = `/resources/blog/${post.id}`;

  if (actor.canApprove) {
    await prisma.blogPost.update({ where, data: { publishedAt: new Date(), submittedAt: null } });
    if (post.authorId !== actor.id) {
      await notify({
        eventType: "blog.approved",
        createdByUserId: actor.id,
        message: { vars: { itemTitle: post.title }, link },
        recipients: [{ userId: post.authorId }],
      });
    }
    return "published";
  }

  if (!post.submittedAt) {
    await prisma.blogPost.update({ where, data: { submittedAt: new Date() } });
    const admins = await adminRecipientIds(actor.id);
    await notify({
      eventType: "blog.submitted",
      createdByUserId: actor.id,
      message: { vars: { personName: fullName(post.author), itemTitle: post.title }, link },
      recipients: admins.map((userId) => ({ userId })),
    });
  }
  return "review";
}

/** Back to a draft: unpublishes, or withdraws a post from review. */
export async function unpublishBlogPost(postId: string): Promise<void> {
  await prisma.blogPost.update({
    where: { id: postId },
    // Only a published post holds a pin.
    data: { publishedAt: null, submittedAt: null, frontPageRank: null },
  });
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
  submittedAt: null,
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
