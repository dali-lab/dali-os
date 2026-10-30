import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";
import { FEED_IDS_MAX, summarizeReactions } from "~/lib/feedback";

export const FEED_PAGE_SIZE = 30;

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, photoUrl: true } as const;

const POST_SELECT = {
  id: true,
  body: true,
  screenshotKey: true,
  pagePath: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
  reactions: { select: { emoji: true, userId: true } },
  comments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
  },
} satisfies Prisma.FeedbackPostSelect;

type Row = Prisma.FeedbackPostGetPayload<{ select: typeof POST_SELECT }>;

export interface FeedbackViewer {
  userId: string;
  core: boolean;
}

async function shapePosts(rows: Row[], viewer: FeedbackViewer) {
  // One presign per distinct author, not per post and comment.
  const photoByUser = new Map<string, Promise<string | null>>();
  const person = async (author: Row["author"]) => {
    if (!photoByUser.has(author.id)) photoByUser.set(author.id, resolvePhotoUrl(author.photoUrl));
    return { id: author.id, name: fullName(author), photoUrl: await photoByUser.get(author.id)! };
  };

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      body: r.body,
      pagePath: r.pagePath,
      screenshotUrl: r.screenshotKey ? `/api/upload/raw?key=${encodeURIComponent(r.screenshotKey)}` : null,
      createdAt: r.createdAt.toISOString(),
      author: await person(r.author),
      canDelete: viewer.core || r.author.id === viewer.userId,
      reactions: summarizeReactions(r.reactions, viewer.userId),
      comments: await Promise.all(
        r.comments.map(async (c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          author: await person(c.author),
          canDelete: viewer.core || c.author.id === viewer.userId,
        })),
      ),
    })),
  );
}

export type FeedbackFeedPost = Awaited<ReturnType<typeof shapePosts>>[number];

export async function loadFeedbackPage(rawCursor: string | null, viewer: FeedbackViewer) {
  const rows = await prisma.feedbackPost.findMany({
    where: keysetAfter("createdAt", decodeCursor(rawCursor)),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FEED_PAGE_SIZE + 1,
    select: POST_SELECT,
  });
  const { items, nextCursor } = keysetPage(rows, FEED_PAGE_SIZE, (r) => ({
    at: r.createdAt.toISOString(),
    id: r.id,
  }));
  return { items: await shapePosts(items, viewer), nextCursor };
}

// Posts missing from the result were deleted since the caller loaded them.
export async function loadFeedbackPostsByIds(ids: string[], viewer: FeedbackViewer) {
  const unique = [...new Set(ids)].slice(0, FEED_IDS_MAX);
  if (unique.length === 0) return [];
  const rows = await prisma.feedbackPost.findMany({
    where: { id: { in: unique } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: POST_SELECT,
  });
  return shapePosts(rows, viewer);
}
