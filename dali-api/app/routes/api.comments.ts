import type { Route } from "./+types/api.comments";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden, type AuthSuccess } from "~/lib/auth";
import { isCore, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { hydrateAuthors } from "~/lib/collabAuth";
import { notify } from "~/lib/notify.server";
import { extractHandlesFromText, resolveHandles, notifyMentions, pageDocLink } from "~/lib/mentions";

// Comments + inline annotations on documents (Pages) and files (ProjectFile).
//   GET  /api/comments?targetType=doc|file&targetId=...   → threads (roots + replies)
//   POST /api/comments  { targetType, targetId, body, parentId?, anchor? }
//
// `anchor` (doc only) carries a Yjs relative-position range so an inline
// comment survives collaborative edits; null = a doc/file-level comment.
// Read + write mirror the project-edit gate (isCore === Admin || Core), the
// same surface that can open the doc/file.

const AnchorSchema = z
  .object({ from: z.string(), to: z.string() })
  .nullable()
  .optional();

const CreateSchema = z.object({
  targetType: z.enum(["doc", "file", "pagedoc"]),
  targetId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  parentId: z.string().nullable().optional(),
  anchor: AnchorSchema,
  // Page-doc FAQ comments only: the page path, so @-mention notifications can
  // deep-link back to the guide (with ?doc=1).
  path: z.string().max(1000).optional(),
});

type CommentTarget = "doc" | "file" | "pagedoc";

// Confirm the target exists and is live, matching authorizeCollabDoc's doc gate.
async function targetExists(targetType: CommentTarget, targetId: string): Promise<boolean> {
  if (targetType === "doc") {
    const page = await prisma.page.findUnique({
      where: { id: targetId },
      select: { workspaceType: true, archivedAt: true },
    });
    return !!page && page.workspaceType === "Project" && page.archivedAt === null;
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

// A partner may comment on a `doc` only when it's a live, partner-visible page
// in a project their org actively partners on — the same gate that lets them
// open the page (partner.projects.$id.pages.$pageId) and its collab socket.
async function partnerCanAccessDoc(userSub: string, pageId: string): Promise<boolean> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      workspaceType: "Project",
      archivedAt: null,
      partnerVisible: true,
    },
    select: { workspaceId: true },
  });
  if (!page?.workspaceId) return false;
  return partnerHasProjectAccess(userSub, page.workspaceId);
}

// Auth split by target: page-doc FAQ threads are open to any lab member (so
// anyone can ask a question); doc comments stay on the project-edit gate
// (Core/Admin), plus partners on that page's shared surface; file comments
// stay Core-only.
async function canAccessTarget(
  auth: AuthSuccess,
  targetType: CommentTarget,
  targetId: string,
): Promise<boolean> {
  if (targetType === "pagedoc") return isLabMember(auth.user.sub);
  if (targetType === "doc") {
    if (await isCore(auth.user.sub)) return true;
    return auth.user.type === "partner"
      ? partnerCanAccessDoc(auth.user.sub, targetId)
      : false;
  }
  return isCore(auth.user.sub);
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
  if (!(await canAccessTarget(auth, targetType, targetId))) {
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
      anchor: true,
      resolvedAt: true,
      createdAt: true,
    },
  });

  const authors = await hydrateAuthors([...new Set(rows.map((r) => r.authorId))]);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));

  const comments = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    author: nameById.get(r.authorId) ?? "Unknown",
    authorId: r.authorId,
    body: r.body,
    anchor: r.anchor as { from: string; to: string } | null,
    resolved: r.resolvedAt !== null,
    createdAt: r.createdAt.toISOString(),
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

  if (!(await canAccessTarget(auth, body.targetType, body.targetId))) {
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

  const created = await prisma.docComment.create({
    data: {
      targetType: body.targetType,
      targetId: body.targetId,
      parentId: body.parentId ?? null,
      authorId: auth.user.sub,
      body: body.body,
      anchor: anchor === null ? undefined : anchor,
      // Real FK only on the file side (see schema note).
      fileId: body.targetType === "file" ? body.targetId : null,
    },
    select: { id: true },
  });

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
  void (async () => {
    const userIds = await resolveHandles(extractHandlesFromText(body.body));
    if (userIds.length === 0) return;
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
      recipientUserIds: userIds,
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
// repliers), except the reply's own author. True @-mentions need mention
// capture in the composer first — this covers the "nobody hears about
// replies" gap the comment pipeline has today.
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
