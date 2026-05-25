import type { Route } from "./+types/api.comments.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/comments/:id  { intent: "resolve" | "reopen" }  — toggle resolved
// DELETE /api/comments/:id                                    — delete (cascades replies)
//
// Same gate as creating comments (isCore). Authors may delete their own;
// Core may delete any. Resolve/reopen is open to any Core editor.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const comment = await prisma.docComment.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    return withCors(request, Response.json({ error: "Comment not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.docComment.delete({ where: { id: comment.id } });
    return withCors(request, Response.json({ ok: true }));
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const intent = (raw as { intent?: string } | null)?.intent;
  if (intent !== "resolve" && intent !== "reopen") {
    return withCors(request, Response.json({ error: "Invalid intent" }, { status: 400 }));
  }

  await prisma.docComment.update({
    where: { id: comment.id },
    data: { resolvedAt: intent === "resolve" ? new Date() : null },
  });
  return withCors(request, Response.json({ ok: true }));
}
