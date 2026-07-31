import type { Route } from "./+types/api.comments.$id";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/comments/:id  { intent: "resolve" | "reopen" }  — toggle resolved
// DELETE /api/comments/:id                                    — delete (cascades replies)
//
// Auth is target- and action-dependent: doc/file threads stay on the Core gate.
// Page-doc FAQ authors may delete their own comments, but only that PageDoc's
// maintainer may resolve or reopen a thread.

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
    select: { id: true, authorId: true, targetType: true, targetId: true },
  });
  if (!comment) {
    return withCors(request, Response.json({ error: "Comment not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    const core = await isCore(auth.user.sub);
    const isAuthor = comment.authorId === auth.user.sub;
    // Authors delete their own on the shared surfaces (page-doc FAQs, and
    // partner comments on shared docs); doc/file threads otherwise stay Core.
    const canDelete =
      comment.targetType === "pagedoc"
        ? core || isAuthor
        : comment.targetType === "doc"
          ? core || (auth.user.type === "partner" && isAuthor)
          : core;
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
  const body = raw as { intent?: string; anchor?: unknown } | null;
  const intent = body?.intent;

  // "set-anchor" is called by DaliThreadStore.addThreadToDocument after
  // BlockNote places the comment mark in the doc; it stamps the anchor column
  // so the rail can identify inline BlockNote threads vs doc-level ones.
  // Auth: only the comment's own author may set the anchor (the store calls
  // this immediately after createThread, so it's always the same user).
  if (intent === "set-anchor") {
    if (comment.targetType !== "doc") {
      return withCors(request, Response.json({ error: "anchor only on docs" }, { status: 400 }));
    }
    if (comment.authorId !== auth.user.sub) {
      return forbidden(request);
    }
    const anchor = body?.anchor ?? null;
    await prisma.docComment.update({
      where: { id: comment.id },
      data: { anchor: anchor === null ? undefined : (anchor as object) },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  // resolve / reopen require Core or pagedoc maintainer.
  if (comment.targetType === "pagedoc") {
    const pageDoc = await prisma.pageDoc.findUnique({
      where: { id: comment.targetId },
      select: { maintainerId: true },
    });
    if (!pageDoc || pageDoc.maintainerId !== auth.user.sub) {
      return forbidden(request);
    }
  } else if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  if (intent !== "resolve" && intent !== "reopen") {
    return withCors(request, Response.json({ error: "Invalid intent" }, { status: 400 }));
  }

  await prisma.docComment.update({
    where: { id: comment.id },
    data: { resolvedAt: intent === "resolve" ? new Date() : null },
  });
  return withCors(request, Response.json({ ok: true }));
}
