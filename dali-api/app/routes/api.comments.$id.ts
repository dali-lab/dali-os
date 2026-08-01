import type { Route } from "./+types/api.comments.$id";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isLabMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { getPageAccess } from "~/lib/pageAccess.server";

// POST   /api/comments/:id  { intent: "resolve" | "reopen" | "edit" | "set-anchor" | "react" | "unreact" }
// DELETE /api/comments/:id
//
// Permission matrix per action:
//
//   resolve/reopen:
//     doc     → canResolve per getPageAccess (canEdit || Core)
//     file    → Core
//     pagedoc → pagedoc maintainer
//
//   edit (body update, author-only):
//     all target types → comment author only
//
//   set-anchor (stamp Yjs range after BlockNote places the mark):
//     doc only → comment author only
//
//   react / unreact:
//     any target type → same canComment access as posting a comment; idempotent
//
//   DELETE:
//     doc     → Core, or comment author (members + partners may delete own)
//     file    → Core only
//     pagedoc → Core, or comment author

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const comment = await prisma.docComment.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, targetType: true, targetId: true, parentId: true },
  });
  if (!comment) {
    return withCors(request, Response.json({ error: "Comment not found" }, { status: 404 }));
  }

  const core = await isCore(auth.user.sub);
  const isAuthor = comment.authorId === auth.user.sub;

  if (request.method === "DELETE") {
    let canDelete: boolean;
    if (comment.targetType === "file") {
      // File artifact feedback is a Core-managed surface.
      canDelete = core;
    } else {
      // doc + pagedoc: author can always delete their own; Core can delete any.
      canDelete = core || isAuthor;
    }
    if (!canDelete) return forbidden(request);

    await prisma.docComment.delete({ where: { id: comment.id } });
    return withCors(request, Response.json({ ok: true }));
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const body = raw as { intent?: string; anchor?: unknown; body?: unknown; emoji?: unknown } | null;
  const intent = body?.intent;

  // "edit" — author updates body, bumps updatedAt. Any target type.
  if (intent === "edit") {
    if (!isAuthor) return forbidden(request);
    const newBody = z.string().trim().min(1).max(5000).safeParse(body?.body);
    if (!newBody.success) {
      return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
    }
    await prisma.docComment.update({
      where: { id: comment.id },
      data: { body: newBody.data },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // "set-anchor" — DaliThreadStore stamps the anchor column after BlockNote
  // places the comment mark in the doc. Author-only; doc target only.
  if (intent === "set-anchor") {
    if (comment.targetType !== "doc") {
      return withCors(request, Response.json({ error: "anchor only on docs" }, { status: 400 }));
    }
    if (!isAuthor) {
      return forbidden(request);
    }
    const anchor = body?.anchor ?? null;
    await prisma.docComment.update({
      where: { id: comment.id },
      data: { anchor: anchor === null ? undefined : (anchor as object) },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // "react" / "unreact" — emoji reaction toggle. Same permission as posting a
  // comment (canComment). Idempotent: react is an upsert, unreact is a no-op if
  // the row doesn't exist.
  if (intent === "react" || intent === "unreact") {
    const emojiParsed = z.string().trim().min(1).max(64).safeParse(body?.emoji);
    if (!emojiParsed.success) {
      return withCors(request, Response.json({ error: "Invalid emoji" }, { status: 400 }));
    }
    const emoji = emojiParsed.data;

    // Permission: same as canComment — viewer with read+comment access.
    // For doc targets, delegate to getPageAccess; for file/pagedoc, the
    // requireAuth check plus existing membership is sufficient (same logic
    // as the GET loader in api.comments.ts canReadTarget).
    if (comment.targetType === "doc") {
      const access = await getPageAccess(auth.user.sub, comment.targetId);
      if (!access.canComment) return forbidden(request);
    }
    // file + pagedoc: being authenticated and having an existing comment row
    // already implies access; no additional check needed.

    if (intent === "react") {
      await prisma.docCommentReaction.upsert({
        where: {
          commentId_userId_emoji: {
            commentId: comment.id,
            userId: auth.user.sub,
            emoji,
          },
        },
        create: { commentId: comment.id, userId: auth.user.sub, emoji },
        update: {},
      });
    } else {
      await prisma.docCommentReaction.deleteMany({
        where: { commentId: comment.id, userId: auth.user.sub, emoji },
      });
    }
    return withCors(request, Response.json({ ok: true }));
  }

  // resolve / reopen
  if (intent !== "resolve" && intent !== "reopen") {
    return withCors(request, Response.json({ error: "Invalid intent" }, { status: 400 }));
  }

  if (comment.targetType === "pagedoc") {
    const pageDoc = await prisma.pageDoc.findUnique({
      where: { id: comment.targetId },
      select: { maintainerId: true },
    });
    if (!pageDoc || pageDoc.maintainerId !== auth.user.sub) {
      return forbidden(request);
    }
  } else if (comment.targetType === "doc") {
    // canResolve = canEdit || Core (per getPageAccess)
    const access = await getPageAccess(auth.user.sub, comment.targetId);
    if (!access.canResolve) return forbidden(request);
  } else {
    // file: Core only
    if (!core) return forbidden(request);
  }

  await prisma.docComment.update({
    where: { id: comment.id },
    data: { resolvedAt: intent === "resolve" ? new Date() : null },
  });
  return withCors(request, Response.json({ ok: true }));
}
