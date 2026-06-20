import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { isInstructorOfOffering } from "./auth";

export interface PostNode {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isFromInstructor: boolean;
  createdAt: string;
  editedAt: string | null;
  iAmSubscribed: boolean;
  replies: ReplyNode[];
}

export interface ReplyNode {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isFromInstructor: boolean;
  createdAt: string;
  editedAt: string | null;
}

export async function listDiscussionThreads(offeringId: string, viewerUserId: string) {
  const topLevel = await prisma.educationDiscussionPost.findMany({
    where: { offeringId, parentPostId: null },
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      },
      subscriptions: { where: { userId: viewerUserId }, select: { id: true } },
    },
  });

  return topLevel.map<PostNode>((p) => ({
    id: p.id,
    body: p.body,
    authorId: p.authorId,
    authorName: formatName(p.author),
    isFromInstructor: p.isFromInstructor,
    createdAt: p.createdAt.toISOString(),
    editedAt: p.editedAt ? p.editedAt.toISOString() : null,
    iAmSubscribed: p.subscriptions.length > 0,
    replies: p.replies.map<ReplyNode>((r) => ({
      id: r.id,
      body: r.body,
      authorId: r.authorId,
      authorName: formatName(r.author),
      isFromInstructor: r.isFromInstructor,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt ? r.editedAt.toISOString() : null,
    })),
  }));
}

export async function createPost(input: {
  offeringId: string;
  authorId: string;
  body: string;
  parentPostId?: string | null;
}) {
  const fromInstructor =
    (await isCore(input.authorId)) ||
    (await isInstructorOfOffering(input.authorId, input.offeringId));

  if (input.parentPostId) {
    // Reject replies-to-replies — only one level of nesting.
    const parent = await prisma.educationDiscussionPost.findUnique({
      where: { id: input.parentPostId },
      select: { id: true, offeringId: true, parentPostId: true },
    });
    if (!parent) throw new Error("Parent post not found");
    if (parent.offeringId !== input.offeringId) throw new Error("Parent belongs to a different offering");
    if (parent.parentPostId !== null) {
      throw new Error("Replies cannot reply to a reply; reply to the top-level post instead");
    }
  }

  const created = await prisma.educationDiscussionPost.create({
    data: {
      offeringId: input.offeringId,
      authorId: input.authorId,
      body: input.body,
      parentPostId: input.parentPostId ?? null,
      isFromInstructor: fromInstructor,
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Subscription bookkeeping: author always auto-subscribed to the
  // top-level post (their own thread or the parent they replied on).
  const topLevelId = input.parentPostId ?? created.id;
  await prisma.educationDiscussionSubscription
    .upsert({
      where: { postId_userId: { postId: topLevelId, userId: input.authorId } },
      update: {},
      create: { postId: topLevelId, userId: input.authorId },
    })
    .catch(() => {});

  return { created, topLevelId, isFromInstructor: fromInstructor };
}

export async function setSubscribed(postId: string, userId: string, subscribed: boolean) {
  // Verify the post is top-level — subscriptions only attach to top-level.
  const post = await prisma.educationDiscussionPost.findUnique({
    where: { id: postId },
    select: { id: true, parentPostId: true, offeringId: true },
  });
  if (!post) throw new Error("Post not found");
  if (post.parentPostId !== null) {
    throw new Error("Subscribe to the top-level post, not a reply");
  }

  if (subscribed) {
    await prisma.educationDiscussionSubscription
      .upsert({
        where: { postId_userId: { postId, userId } },
        update: {},
        create: { postId, userId },
      })
      .catch(() => {});
  } else {
    await prisma.educationDiscussionSubscription.deleteMany({
      where: { postId, userId },
    });
  }
  return post;
}

export async function getPostForEdit(postId: string) {
  return prisma.educationDiscussionPost.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, offeringId: true, parentPostId: true, body: true },
  });
}

export async function updatePostBody(postId: string, body: string) {
  return prisma.educationDiscussionPost.update({
    where: { id: postId },
    data: { body, editedAt: new Date() },
  });
}

export async function deletePost(postId: string) {
  // Replies first (FK is SET NULL but that would orphan; we'd rather cascade
  // the visible tree).
  await prisma.educationDiscussionPost.deleteMany({ where: { parentPostId: postId } });
  await prisma.educationDiscussionPost.delete({ where: { id: postId } });
}

function formatName(u: { firstName: string | null; lastName: string | null } | null | undefined) {
  if (!u) return "Someone";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Someone";
}
