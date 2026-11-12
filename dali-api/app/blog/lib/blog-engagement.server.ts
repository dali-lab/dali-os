import { data } from "react-router";
import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { checkRateLimit } from "~/lib/rate-limit";
import { summarizeReactions } from "~/lib/reactions";
import { toggleReaction, withEmojiImages } from "~/lib/reactions.server";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions";
import { BLOG_COMMENT_MAX } from "~/blog/lib/blog-engagement";

export type BlogReader = { id: string; core: boolean; name: string };

/** Reactions and comments under a published story; drafts have none. */
export async function loadBlogEngagement(viewer: BlogReader, postId: string) {
  const [reactions, comments] = await Promise.all([
    prisma.blogReaction.findMany({
      where: { postId },
      select: {
        emoji: true,
        userId: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.blogComment.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
      },
    }),
  ]);
  const photos = new Map<string, Promise<string | null>>();
  const photo = (a: { id: string; photoUrl: string | null }) => {
    if (!photos.has(a.id)) photos.set(a.id, resolvePhotoUrl(a.photoUrl));
    return photos.get(a.id)!;
  };
  const [withImages] = await withEmojiImages([
    { reactions: summarizeReactions(reactions, viewer.id) },
  ]);
  return {
    reactions: withImages.reactions,
    comments: await Promise.all(
      comments.map(async (c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        author: { name: fullName(c.author), photoUrl: await photo(c.author) },
        canDelete: viewer.core || c.author.id === viewer.id,
      })),
    ),
  };
}

export type BlogEngagement = Awaited<ReturnType<typeof loadBlogEngagement>>;

const fail = (status: number) => data({ ok: false as const }, { status });

/** The read page's `react`, `comment` and `delete-comment` intents. */
export async function blogEngagementAction(request: Request, viewer: BlogReader, postId: string) {
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const link = `/resources/blog/${postId}`;

  switch (form.get("intent")) {
    case "react": {
      if (checkRateLimit(request, { max: 60, windowMs: 60_000 }, `blog-react:${viewer.id}`)) {
        return fail(429);
      }
      const post = await publishedPost(postId);
      if (!post) return fail(404);
      const emoji = text("emoji");
      const mine = { postId, userId: viewer.id, emoji };
      const result = await toggleReaction(
        {
          remove: async () => (await prisma.blogReaction.deleteMany({ where: mine })).count,
          usedEmoji: async () =>
            (
              await prisma.blogReaction.findMany({
                where: { postId },
                select: { emoji: true },
                distinct: ["emoji"],
              })
            ).map((r) => r.emoji),
          add: () =>
            prisma.blogReaction.upsert({
              where: { postId_userId_emoji: mine },
              create: mine,
              update: {},
            }),
        },
        emoji,
      );
      if (typeof result === "number") return fail(result);
      if (result === "added" && post.authorId !== viewer.id) {
        await notify({
          eventType: "blog.reaction",
          createdByUserId: viewer.id,
          message: {
            vars: { personName: viewer.name, itemDetail: `${emoji} "${post.title}"` },
            link,
          },
          recipients: [{ userId: post.authorId }],
        });
      }
      break;
    }
    case "comment": {
      if (checkRateLimit(request, { max: 30, windowMs: 60_000 }, `blog-comment:${viewer.id}`)) {
        return fail(429);
      }
      const body = text("body");
      if (!body || body.length > BLOG_COMMENT_MAX) return fail(400);
      const post = await publishedPost(postId);
      if (!post) return fail(404);
      await prisma.blogComment.create({ data: { postId, authorId: viewer.id, body } });
      const mentioned = new Set(await resolveHandles(extractHandlesFromText(body)));
      mentioned.delete(viewer.id);
      // A mentioned author gets the mention, not a second "commented" ping.
      if (post.authorId !== viewer.id && !mentioned.has(post.authorId)) {
        await notify({
          eventType: "blog.comment",
          createdByUserId: viewer.id,
          message: { vars: { personName: viewer.name, itemDetail: body }, link },
          recipients: [{ userId: post.authorId }],
        });
      }
      await notifyMentions({
        recipientUserIds: [...mentioned],
        actorId: viewer.id,
        link,
        copyKey: "mention.comment",
        preview: body,
      });
      break;
    }
    case "delete-comment":
      await prisma.blogComment.deleteMany({
        where: { id: text("commentId"), postId, ...(viewer.core ? {} : { authorId: viewer.id }) },
      });
      break;
    default:
      return fail(400);
  }
  return { ok: true as const };
}

function publishedPost(id: string) {
  return prisma.blogPost.findFirst({
    where: { id, publishedAt: { not: null } },
    select: { authorId: true, title: true },
  });
}
