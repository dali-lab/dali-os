import { prisma } from "~/lib/db.server";
import { notifyFileComment } from "~/projects/lib/file-notifications.server";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, resolveHandles, notifyMentions, pageDocLink } from "~/lib/mentions.server";
import { publishCommentChange } from "~/lib/comment-events.server";
import type { BodySegment } from "~/lib/comment-body";
import { anchorSlideId, type commentAnchorSchema } from "~/lib/slide-comments";
import type { z } from "zod";
import { docCommentContext } from "~/lib/comment-links.server";
import { critActorIsAnonymous, critPostExists, critThreadLink, notifyCritComment } from "~/lib/crit-comments.server";

type CommentAnchor = z.infer<typeof commentAnchorSchema>;

export type CommentTarget = "doc" | "file" | "pagedoc" | "crit";

export class CommentCreateError extends Error {
  constructor(
    message: string,
    public status: 400 | 404,
  ) {
    super(message);
    this.name = "CommentCreateError";
  }
}

// Confirm the target exists and is live. Accepts ALL page workspace types
// (not just Project) so Lab/Education/personal pages don't 404.
async function targetExists(targetType: CommentTarget, targetId: string): Promise<boolean> {
  if (targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: targetId },
      select: { archivedAt: true },
    });
    return !!page && page.archivedAt === null;
  }
  if (targetType === "crit") return (await critPostExists(targetId)) !== null;
  if (targetType === "pagedoc") {
    const doc = await prisma.pageDoc.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    return doc !== null;
  }
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { archivedAt: true },
  });
  return !!file && file.archivedAt === null;
}

export async function createDocComment(a: {
  targetType: CommentTarget;
  targetId: string;
  parentId?: string | null;
  authorId: string;
  body: string;
  bodyJson?: BodySegment[] | null;
  anchor?: CommentAnchor;
  versionId?: string | null;
  path?: string;
}): Promise<{ id: string }> {
  const { targetType, targetId, parentId, authorId, body, bodyJson, path } = a;

  if (!(await targetExists(targetType, targetId))) {
    throw new CommentCreateError("Target not found", 404);
  }
  if (parentId) {
    const parent = await prisma.docComment.findUnique({
      where: { id: parentId },
      select: { targetType: true, targetId: true, parentId: true },
    });
    if (
      !parent ||
      parent.targetType !== targetType ||
      parent.targetId !== targetId ||
      parent.parentId !== null
    ) {
      throw new CommentCreateError("Invalid parent comment", 400);
    }
  }
  const anchor = targetType === "doc" || targetType === "crit" ? (a.anchor ?? null) : null;
  const anchorKind = (anchor as { kind?: string } | null)?.kind;
  if (anchorKind === "image" || targetType === "crit") {
    if (targetType !== "crit") throw new CommentCreateError("Image pins only apply to Crit Wall posts", 400);
    if (anchor !== null) {
      if (anchorKind !== "image") throw new CommentCreateError("Crit Wall comments only take image pins", 400);
      if (parentId) throw new CommentCreateError("Replies can't be pinned", 400);
      if ((await critPostExists(targetId))?.kind !== "image") {
        throw new CommentCreateError("Pins only apply to images", 400);
      }
    }
  } else if (anchorSlideId(anchor) !== null || anchorKind === "slide") {
    const page = await prisma.page.findUnique({ where: { id: targetId }, select: { kind: true } });
    if (page?.kind !== "Slides") {
      throw new CommentCreateError("Slide anchors only apply to slide decks", 400);
    }
  }

  let versionId: string | null = null;
  if (targetType === "file") {
    if (a.versionId) {
      const version = await prisma.projectFileVersion.findFirst({
        where: { id: a.versionId, fileId: targetId },
        select: { id: true },
      });
      if (!version) throw new CommentCreateError("Invalid version", 400);
      versionId = version.id;
    } else {
      versionId =
        (
          await prisma.projectFile.findUnique({
            where: { id: targetId },
            select: { currentVersionId: true },
          })
        )?.currentVersionId ?? null;
    }
  }

  const created = await prisma.docComment.create({
    data: {
      targetType,
      targetId,
      parentId: parentId ?? null,
      authorId,
      body,
      bodyJson: bodyJson ?? undefined,
      anchor: anchor === null ? undefined : anchor,
      fileId: targetType === "file" ? targetId : null,
      versionId,
    },
    select: { id: true },
  });

  if (targetType === "doc") publishCommentChange(targetId);

  if (targetType === "file" && !parentId) {
    void notifyFileComment({ fileId: targetId, authorId, body }).catch((err) =>
      console.error(`comment ${created.id}: file comment notify failed`, err),
    );
  }

  if (targetType === "crit" && !parentId) {
    void notifyCritComment({ submissionId: targetId, commenterId: authorId, commentId: created.id, body }).catch((err) =>
      console.error(`comment ${created.id}: crit notify failed`, err),
    );
  }

  if (parentId) {
    void notifyThreadReply({ targetType, targetId, rootId: parentId, authorId, body, path }).catch((err) =>
      console.error(`comment ${created.id}: reply notify failed`, err),
    );
  }

  void (async () => {
    const allIds = new Set<string>();
    if (bodyJson) {
      for (const seg of bodyJson) {
        if (seg.type === "mention" && seg.userId) allIds.add(seg.userId);
      }
    }
    if (targetType !== "doc" || !bodyJson || bodyJson.length === 0) {
      const handleIds = await resolveHandles(extractHandlesFromText(body));
      for (const id of handleIds) allIds.add(id);
    }
    if (allIds.size === 0) return;

    let link: string;
    if (targetType === "doc") {
      link = (await docCommentContext(targetId, parentId ?? created.id, created.id, parentId ? undefined : (anchor))).link;
    } else if (targetType === "crit") {
      link = await critThreadLink(targetId, parentId ?? created.id);
    } else {
      const base = targetType === "pagedoc" ? pageDocLink(path) : `/documents/file/${targetId}`;
      link = `${base}${base.includes("?") ? "&" : "?"}comment=${created.id}`;
    }
    await notifyMentions({
      recipientUserIds: [...allIds],
      actorId: authorId,
      link,
      copyKey: "mention.comment",
      preview: body,
      anonymousActor: targetType === "crit" && (await critActorIsAnonymous(targetId, authorId)),
    });
  })().catch((err) => console.error(`comment ${created.id}: mention notify failed`, err));

  return created;
}

// A reply notifies everyone already in the thread (root author + prior
// repliers), except the reply's own author.
async function notifyThreadReply(args: {
  targetType: CommentTarget;
  targetId: string;
  rootId: string;
  authorId: string;
  body: string;
  path?: string;
}): Promise<void> {
  const thread = await prisma.docComment.findMany({
    where: { OR: [{ id: args.rootId }, { parentId: args.rootId }] },
    select: { authorId: true },
  });
  const recipients = [...new Set(thread.map((c) => c.authorId))].filter(
    (id) => id !== args.authorId,
  );
  if (recipients.length === 0) return;

  let title: string | null | undefined;
  let link: string;
  let partnerLink: string | null = null;
  let partnerIds = new Set<string>();
  if (args.targetType === "doc") {
    const context = await docCommentContext(args.targetId, args.rootId, args.rootId);
    title = context.title;
    link = context.replyLink;
    partnerLink = context.partnerReplyLink;
    if (partnerLink) partnerIds = await partnerAccountIds(recipients);
  } else if (args.targetType === "pagedoc") {
    title = (
      await prisma.pageDoc.findUnique({
        where: { id: args.targetId },
        select: { title: true },
      })
    )?.title;
    link = pageDocLink(args.path);
  } else if (args.targetType === "crit") {
    title = (
      await prisma.critSubmission.findUnique({
        where: { id: args.targetId },
        select: { title: true },
      })
    )?.title;
    link = await critThreadLink(args.targetId, args.rootId);
  } else {
    title = (
      await prisma.projectFile.findUnique({
        where: { id: args.targetId },
        select: { title: true },
      })
    )?.title;
    link = `/documents/file/${args.targetId}`;
  }
  const preview = args.body.length > 200 ? `${args.body.slice(0, 200)}…` : args.body;

  const anonymousActor = args.targetType === "crit" && (await critActorIsAnonymous(args.targetId, args.authorId));
  await notify({
    eventType: "collab.comment_reply",
    createdByUserId: anonymousActor ? null : args.authorId,
    message: {
      vars: { itemTitle: title ?? "a document", itemDetail: preview },
      link,
    },
    recipients: recipients.map((userId) =>
      partnerLink && partnerIds.has(userId) ? { userId, link: partnerLink } : { userId },
    ),
  });
}

async function partnerAccountIds(userIds: string[]): Promise<Set<string>> {
  const contacts = await prisma.partnerContact.findMany({
    where: { userId: { in: userIds }, user: { daliMember: { is: null } } },
    select: { userId: true },
  });
  return new Set(contacts.flatMap((c) => (c.userId ? [c.userId] : [])));
}
