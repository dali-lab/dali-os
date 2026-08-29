import type { Route } from "./+types/api.comments";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden, type AuthSuccess } from "~/lib/auth";
import { isLabMember, isProjectMember } from "~/lib/roles";
import { notifyFileComment } from "~/projects/lib/file-notifications.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { hydrateAuthors } from "~/lib/collabAuth";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, resolveHandles, notifyMentions, pageDocLink } from "~/lib/mentions";
import { getPageAccess } from "~/lib/pageAccess.server";
import { publishCommentChange } from "~/lib/comment-events.server";
import type { BodySegment } from "~/lib/comment-body";

// Comments + inline annotations on documents (Pages) and files (ProjectFile).
//   GET  /api/comments?targetType=doc|file|pagedoc&targetId=...   → threads (roots + replies)
//   POST /api/comments  { targetType, targetId, body, parentId?, anchor? }
//
// `anchor` (doc only) carries a Yjs relative-position range so an inline
// comment survives collaborative edits; null = a doc/file-level comment.
//
// Permission matrix:
//   doc target   — read/create/reply: canView (any member, partner-visible partner)
//                  resolve/reopen: canResolve (canEdit || Core)
//   file target  — read/create/reply: Core or project member of owning project
//                  resolve/reopen: Core
//   pagedoc      — read/create/reply: any lab member (open FAQ threads)
//                  resolve/reopen: pagedoc maintainer

const AnchorSchema = z
  .object({ from: z.string(), to: z.string() })
  .nullable()
  .optional();

// bodyJson segment schema — mirrors the BodySegment union from MentionTextInput.
// We accept the raw JSON from the client and store it as-is; validation here
// is permissive (array of objects) to avoid version skew issues.
const BodySegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({
    type: z.literal("mention"),
    userId: z.string().min(1).max(256),
    label: z.string().max(256),
  }),
]);

const CreateSchema = z.object({
  targetType: z.enum(["doc", "file", "pagedoc"]),
  targetId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  /** Rich inline segments. When present, stored in DocComment.bodyJson and used
   * for mention notifications (userId-based, exact; supplement the handle-based
   * path which still runs for backward-compat). */
  bodyJson: z.array(BodySegmentSchema).max(500).nullable().optional(),
  parentId: z.string().nullable().optional(),
  anchor: AnchorSchema,
  // Page-doc FAQ comments only: the page path, so @-mention notifications can
  // deep-link back to the guide (with ?doc=1).
  path: z.string().max(1000).optional(),
  // File comments only: the version the commenter was viewing, so feedback
  // is pinned to the iteration it was written against.
  versionId: z.string().min(1).nullable().optional(),
});

type CommentTarget = "doc" | "file" | "pagedoc";

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

// Auth split by target type:
//   pagedoc — any lab member (open FAQ)
//   doc     — canView per getPageAccess (any member, or partner on partner-visible page)
//   file    — Core or project member of the owning project
async function canReadTarget(
  auth: AuthSuccess,
  targetType: CommentTarget,
  targetId: string,
): Promise<boolean> {
  if (targetType === "pagedoc") return isLabMember(auth.user.sub);
  if (targetType === "doc") {
    const access = await getPageAccess(auth.user.sub, targetId);
    return access.canComment;
  }
  // file: Core or project member
  const { isCore } = await import("~/lib/roles");
  if (await isCore(auth.user.sub)) return true;
  const file = await prisma.projectFile.findUnique({
    where: { id: targetId },
    select: { projectId: true },
  });
  if (!file || !file.projectId) return false;
  return isProjectMember(auth.user.sub, file.projectId);
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType");
  const targetId = url.searchParams.get("targetId");
  if (
    (targetType !== "doc" && targetType !== "file" && targetType !== "pagedoc") ||
    !targetId
  ) {
    return withCors(request, Response.json({ error: "Invalid target" }, { status: 400 }));
  }
  if (!(await canReadTarget(auth, targetType, targetId))) {
    return forbidden(request);
  }

  const rows = await prisma.docComment.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      parentId: true,
      authorId: true,
      body: true,
      bodyJson: true,
      anchor: true,
      resolvedAt: true,
      createdAt: true,
      versionId: true,
      updatedAt: true,
      reactions: {
        select: { userId: true, emoji: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const authors = await hydrateAuthors([...new Set(rows.map((r) => r.authorId))]);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));
  const photoById = new Map(authors.map((a) => [a.id, a.photoUrl]));

  const comments = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    author: nameById.get(r.authorId) ?? "Unknown",
    authorId: r.authorId,
    authorPhotoUrl: photoById.get(r.authorId) ?? null,
    body: r.body,
    bodyJson: r.bodyJson as BodySegment[] | null,
    anchor: r.anchor as { from: string; to: string } | null,
    resolved: r.resolvedAt !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    versionId: r.versionId,
    reactions: r.reactions,
  }));

  return withCors(request, Response.json({ comments }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return withCors(request, body);

  if (!(await canReadTarget(auth, body.targetType, body.targetId))) {
    return forbidden(request);
  }

  if (!(await targetExists(body.targetType, body.targetId))) {
    return withCors(request, Response.json({ error: "Target not found" }, { status: 404 }));
  }
  // Replies must point at an existing root comment on the same target. Only one
  // level of threading: reject replying to a reply.
  if (body.parentId) {
    const parent = await prisma.docComment.findUnique({
      where: { id: body.parentId },
      select: { targetType: true, targetId: true, parentId: true },
    });
    if (
      !parent ||
      parent.targetType !== body.targetType ||
      parent.targetId !== body.targetId ||
      parent.parentId !== null
    ) {
      return withCors(request, Response.json({ error: "Invalid parent comment" }, { status: 400 }));
    }
  }
  // Anchors only make sense on documents.
  const anchor = body.targetType === "doc" ? (body.anchor ?? null) : null;

  // File comments are pinned to a version so feedback reads against the
  // right iteration: the one the commenter was viewing (sent by the file
  // page), falling back to the current version for callers that don't say.
  let versionId: string | null = null;
  if (body.targetType === "file") {
    if (body.versionId) {
      const version = await prisma.projectFileVersion.findFirst({
        where: { id: body.versionId, fileId: body.targetId },
        select: { id: true },
      });
      if (!version) {
        return withCors(request, Response.json({ error: "Invalid version" }, { status: 400 }));
      }
      versionId = version.id;
    } else {
      versionId =
        (
          await prisma.projectFile.findUnique({
            where: { id: body.targetId },
            select: { currentVersionId: true },
          })
        )?.currentVersionId ?? null;
    }
  }

  const created = await prisma.docComment.create({
    data: {
      targetType: body.targetType,
      targetId: body.targetId,
      parentId: body.parentId ?? null,
      authorId: auth.user.sub,
      body: body.body,
      // Store rich segments when provided; null for legacy plain-text comments.
      bodyJson: body.bodyJson ?? undefined,
      anchor: anchor === null ? undefined : anchor,
      // Real FK only on the file side (see schema note).
      fileId: body.targetType === "file" ? body.targetId : null,
      versionId,
    },
    select: { id: true },
  });

  // Nudge any open comment-stream listeners for this page so they refetch.
  if (body.targetType === "doc") {
    publishCommentChange(body.targetId);
  }

  // Root comments on a file notify its audience (uploaders + linked-task
  // assignees). Replies are covered by the thread-reply path below.
  if (body.targetType === "file" && !body.parentId) {
    void notifyFileComment({
      fileId: body.targetId,
      authorId: auth.user.sub,
      body: body.body,
    }).catch((err) =>
      console.error(`comment ${created.id}: file comment notify failed`, err),
    );
  }

  if (body.parentId) {
    void notifyThreadReply({
      targetType: body.targetType,
      targetId: body.targetId,
      rootId: body.parentId,
      authorId: auth.user.sub,
      body: body.body,
      path: body.path,
    }).catch((err) =>
      console.error(`comment ${created.id}: reply notify failed`, err),
    );
  }

  // @-mentions in any comment (document, file, or page-doc FAQ) notify the
  // tagged members. Root or reply.
  // Two paths, deduped:
  //   1. bodyJson mention segments — exact userId, no handle resolution needed.
  //   2. Legacy @handle tokens in plain body — resolves handles for comments
  //      that arrive without bodyJson (old clients, file comments, pagedoc FAQ).
  void (async () => {
    const allIds = new Set<string>();

    // Path 1: userId from bodyJson mention segments (preferred, exact).
    if (body.bodyJson) {
      for (const seg of body.bodyJson) {
        if (seg.type === "mention" && seg.userId) allIds.add(seg.userId);
      }
    }

    // Path 2: handle-based for pagedoc/file targets and legacy plain-text.
    // Skip if bodyJson already gave us the full set (all doc targets with bodyJson).
    if (body.targetType !== "doc" || !body.bodyJson || body.bodyJson.length === 0) {
      const handleIds = await resolveHandles(extractHandlesFromText(body.body));
      for (const id of handleIds) allIds.add(id);
    }

    if (allIds.size === 0) return;

    const base =
      body.targetType === "pagedoc"
        ? pageDocLink(body.path)
        : body.targetType === "doc"
          ? `/documents/${body.targetId}`
          : `/documents/file/${body.targetId}`;
    // ?comment=<id> tells the comments rail on that surface to scroll to and
    // flash the exact comment.
    const link = `${base}${base.includes("?") ? "&" : "?"}comment=${created.id}`;
    await notifyMentions({
      recipientUserIds: [...allIds],
      actorId: auth.user.sub,
      link,
      title: "You were mentioned in a comment",
      preview: body.body,
    });
  })().catch((err) =>
    console.error(`comment ${created.id}: mention notify failed`, err),
  );

  return withCors(request, Response.json({ id: created.id }, { status: 201 }));
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
  if (args.targetType === "doc") {
    title = (
      await prisma.page.findUnique({
        where: { id: args.targetId },
        select: { title: true },
      })
    )?.title;
    link = `/documents/${args.targetId}`;
  } else if (args.targetType === "pagedoc") {
    title = (
      await prisma.pageDoc.findUnique({
        where: { id: args.targetId },
        select: { title: true },
      })
    )?.title;
    link = pageDocLink(args.path);
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

  await notify({
    eventType: "collab.comment_reply",
    createdByUserId: args.authorId,
    message: {
      title: `New reply on: ${title ?? "a document"}`,
      body: preview,
      link,
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}
