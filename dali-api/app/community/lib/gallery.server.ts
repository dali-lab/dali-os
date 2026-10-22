import { data } from "react-router";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";
import { checkRateLimit } from "~/lib/rate-limit";
import { summarizeReactions } from "~/lib/feedback";
import { notify } from "~/lib/notify.server";
import { requireCommunityViewer } from "~/community/lib/community.server";
import {
  GALLERY_COMMENT_MAX,
  GALLERY_EMOJI,
  GALLERY_PAGE_SIZE,
  GALLERY_REPORTS_TO_HIDE,
  isGalleryEmoji,
  parseNewPosts,
} from "~/community/lib/gallery";

export type GalleryViewer = { id: string; core: boolean; name: string };

export async function requireGalleryViewer(request: Request): Promise<GalleryViewer> {
  const { user, core } = await requireCommunityViewer(request);
  return { id: user.sub, core, name: fullName(user) || user.email };
}

const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  photoUrl: true,
  classYear: true,
} as const;

const TILE_SELECT = {
  id: true,
  imageKey: true,
  thumbKey: true,
  width: true,
  height: true,
  color: true,
  caption: true,
  hiddenAt: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
  reactions: { select: { emoji: true, userId: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.GalleryPostSelect;

type AuthorRow = Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>;
type TileRow = Prisma.GalleryPostGetPayload<{ select: typeof TILE_SELECT }>;

const IMAGE_URL_WINDOW_S = 3600;

// Gallery images never change once uploaded, so each gets a link that stays
// the same for an hour and that S3 serves with an immutable Cache-Control:
// the browser loads a photo once rather than on every visit. Without S3 (local
// dev) the session-authed redirect route still works.
export async function galleryImageUrl(key: string) {
  if (!isS3Configured()) return `/api/upload/raw?key=${encodeURIComponent(key)}`;
  return getDownloadUrl(key, { cacheFor: IMAGE_URL_WINDOW_S });
}

/** Hidden posts stay visible to Core and to the person who posted them. */
export function visibleTo(viewer: GalleryViewer): Prisma.GalleryPostWhereInput {
  return viewer.core ? {} : { OR: [{ hiddenAt: null }, { authorId: viewer.id }] };
}

// One presign per distinct person across a response.
function personResolver() {
  const photos = new Map<string, Promise<string | null>>();
  return async (a: AuthorRow) => {
    if (!photos.has(a.id)) photos.set(a.id, resolvePhotoUrl(a.photoUrl));
    return {
      id: a.id,
      name: fullName(a),
      classYear: a.classYear,
      photoUrl: await photos.get(a.id)!,
    };
  };
}

async function toTiles(rows: TileRow[], viewer: GalleryViewer) {
  const person = personResolver();
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      imageUrl: await galleryImageUrl(r.thumbKey ?? r.imageKey),
      width: r.width,
      height: r.height,
      color: r.color,
      caption: r.caption,
      hidden: r.hiddenAt !== null,
      createdAt: r.createdAt.toISOString(),
      author: await person(r.author),
      reactions: summarizeReactions(r.reactions, viewer.id, GALLERY_EMOJI),
      commentCount: r._count.comments,
      mine: r.author.id === viewer.id,
      canModerate: viewer.core,
    })),
  );
}

export type GalleryTileData = Awaited<ReturnType<typeof toTiles>>[number];

export type FeedQuery = {
  mine: boolean;
  q: string;
  cursor: string | null;
  excludeId?: string;
};

export function parseFeedQuery(url: URL): FeedQuery {
  return {
    mine: url.searchParams.get("show") === "mine",
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 100),
    cursor: url.searchParams.get("cursor") || null,
  };
}

function feedWhere(viewer: GalleryViewer, query: FeedQuery): Prisma.GalleryPostWhereInput {
  const and: Prisma.GalleryPostWhereInput[] = [visibleTo(viewer)];
  if (query.mine) and.push({ authorId: viewer.id });
  if (query.excludeId) and.push({ id: { not: query.excludeId } });
  for (const word of query.q.split(/\s+/).filter(Boolean)) {
    const contains = { contains: word, mode: "insensitive" as const };
    and.push({
      OR: [
        { caption: contains },
        { author: { firstName: contains } },
        { author: { lastName: contains } },
      ],
    });
  }
  return { AND: and };
}

/** One page of the feed, newest first, plus the cursor for the next page. */
export async function loadGalleryPage(viewer: GalleryViewer, query: FeedQuery) {
  const rows = await prisma.galleryPost.findMany({
    where: feedWhere(viewer, query),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GALLERY_PAGE_SIZE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: TILE_SELECT,
  });
  const more = rows.length > GALLERY_PAGE_SIZE;
  const page = more ? rows.slice(0, GALLERY_PAGE_SIZE) : rows;
  return {
    posts: await toTiles(page, viewer),
    nextCursor: more ? page[page.length - 1].id : null,
  };
}

/** When the gallery began, for the "That's everything" line at the end of the feed. */
export async function firstPostAt(viewer: GalleryViewer) {
  const first = await prisma.galleryPost.findFirst({
    where: visibleTo(viewer),
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return first?.createdAt.toISOString() ?? null;
}

/** Visible posts newer than `since`, for the "N new posts" pill. */
export async function countNewerPosts(viewer: GalleryViewer, since: Date) {
  return prisma.galleryPost.count({
    where: { AND: [visibleTo(viewer), { createdAt: { gt: since } }] },
  });
}

export async function loadGalleryPost(viewer: GalleryViewer, postId: string) {
  const row = await prisma.galleryPost.findFirst({
    where: { AND: [{ id: postId }, visibleTo(viewer)] },
    select: {
      ...TILE_SELECT,
      comments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
      },
      reports: { select: { reporterId: true } },
    },
  });
  if (!row) return null;
  const person = personResolver();
  const [[tile], fullImageUrl] = await Promise.all([
    toTiles([row], viewer),
    galleryImageUrl(row.imageKey),
  ]);
  return {
    ...tile,
    fullImageUrl,
    reportCount: row.reports.length,
    reportedByMe: row.reports.some((r) => r.reporterId === viewer.id),
    comments: await Promise.all(
      row.comments.map(async (c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        author: await person(c.author),
        canDelete: viewer.core || c.author.id === viewer.id,
      })),
    ),
  };
}

export type GalleryPostDetail = NonNullable<Awaited<ReturnType<typeof loadGalleryPost>>>;

// Returned, not thrown: every intent posts through a fetcher, and a thrown
// response would replace the feed with the error boundary.
const fail = (status: number, error?: string) => data({ ok: false as const, error }, { status });

async function visiblePost(viewer: GalleryViewer, id: string) {
  return prisma.galleryPost.findFirst({
    where: { AND: [{ id }, visibleTo(viewer)] },
    select: { id: true, authorId: true, caption: true },
  });
}

function captionPreview(caption: string | null) {
  return caption ? `"${caption.length > 80 ? `${caption.slice(0, 79)}…` : caption}"` : "Your photo";
}

export async function galleryAction(request: Request, viewer: GalleryViewer) {
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const postId = text("postId");
  const link = `/community/gallery/${postId}`;

  switch (form.get("intent")) {
    case "create": {
      const limited = checkRateLimit(request, { max: 10, windowMs: 60_000 }, `gallery:${viewer.id}`);
      if (limited) return fail(429, "Too many uploads. Try again in a minute.");
      const posts = parseNewPosts(text("posts"), viewer.id);
      if (!posts) return fail(400, "Some photos could not be posted.");
      // createMany can't promise order, so stamp each a millisecond apart: the
      // first photo in the composer stays first in the feed.
      const now = Date.now();
      await prisma.galleryPost.createMany({
        data: posts.map((p, i) => ({
          ...p,
          authorId: viewer.id,
          createdAt: new Date(now + (posts.length - 1 - i)),
        })),
      });
      return { ok: true as const, created: posts.length };
    }
    case "react": {
      const emoji = text("emoji");
      if (!isGalleryEmoji(emoji)) return fail(400);
      const post = await visiblePost(viewer, postId);
      if (!post) return fail(404);
      const mine = { postId, userId: viewer.id, emoji };
      const { count } = await prisma.galleryReaction.deleteMany({ where: mine });
      if (count === 0) {
        await prisma.galleryReaction.upsert({
          where: { postId_userId_emoji: mine },
          create: mine,
          update: {},
        });
        if (post.authorId !== viewer.id) {
          await notify({
            eventType: "gallery.reaction",
            createdByUserId: viewer.id,
            message: {
              vars: { personName: viewer.name, itemDetail: `${emoji} ${captionPreview(post.caption)}` },
              link,
            },
            recipients: [{ userId: post.authorId }],
          });
        }
      }
      break;
    }
    case "comment": {
      const limited = checkRateLimit(request, { max: 30, windowMs: 60_000 }, `gallery-comment:${viewer.id}`);
      if (limited) return fail(429);
      const body = text("body");
      if (!body || body.length > GALLERY_COMMENT_MAX) return fail(400);
      const post = await visiblePost(viewer, postId);
      if (!post) return fail(404);
      await prisma.galleryComment.create({ data: { postId, authorId: viewer.id, body } });
      if (post.authorId !== viewer.id) {
        await notify({
          eventType: "gallery.comment",
          createdByUserId: viewer.id,
          message: { vars: { personName: viewer.name, itemDetail: body }, link },
          recipients: [{ userId: post.authorId }],
        });
      }
      break;
    }
    case "delete-comment":
      await prisma.galleryComment.deleteMany({
        where: { id: text("commentId"), ...(viewer.core ? {} : { authorId: viewer.id }) },
      });
      break;
    case "delete":
      await prisma.galleryPost.deleteMany({ where: { id: postId, authorId: viewer.id } });
      break;
    case "report": {
      const post = await visiblePost(viewer, postId);
      if (!post || post.authorId === viewer.id) return fail(404);
      const reason = text("reason").slice(0, 500) || null;
      await prisma.galleryReport.upsert({
        where: { postId_reporterId: { postId, reporterId: viewer.id } },
        create: { postId, reporterId: viewer.id, reason },
        update: { reason },
      });
      const reports = await prisma.galleryReport.count({ where: { postId } });
      if (reports >= GALLERY_REPORTS_TO_HIDE) {
        await prisma.galleryPost.updateMany({
          where: { id: postId, hiddenAt: null },
          data: { hiddenAt: new Date() },
        });
      }
      break;
    }
    case "hide":
      if (!viewer.core) return fail(403);
      await prisma.galleryPost.updateMany({
        where: { id: postId, hiddenAt: null },
        data: { hiddenAt: new Date(), hiddenById: viewer.id },
      });
      break;
    case "restore":
      if (!viewer.core) return fail(403);
      // Clearing the reports too, or the next one would hide it again at once.
      await prisma.$transaction([
        prisma.galleryReport.deleteMany({ where: { postId } }),
        prisma.galleryPost.updateMany({
          where: { id: postId },
          data: { hiddenAt: null, hiddenById: null },
        }),
      ]);
      break;
    default:
      return fail(400);
  }
  return { ok: true as const };
}
