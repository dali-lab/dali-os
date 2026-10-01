import { prisma } from "~/lib/db";
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
