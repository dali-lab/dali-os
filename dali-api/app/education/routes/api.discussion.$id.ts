import type { Route } from "./+types/api.discussion.$id";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { deletePost, getPostForEdit, updatePostBody } from "~/education/lib/discussions-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const post = await getPostForEdit(params.id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });

  const isOwner = post.authorId === auth.user.sub;
  const isManager = await canManageOffering(auth.user.sub, post.offeringId);
  // Authors can edit/delete own posts; managers can delete any post (for
  // moderation). Managers cannot edit other people's posts.

  if (request.method === "DELETE") {
    if (!isOwner && !isManager) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    await deletePost(params.id);
    await logAuditEvent({
      action: "education.discussion.delete",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { offeringId: post.offeringId, byOwner: isOwner },
      request,
    });
    return Response.json({ ok: true });
  }

  if (request.method !== "PATCH" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isOwner) {
    return Response.json({ error: "Only the author can edit" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return Response.json({ error: "body required" }, { status: 400 });

  const updated = await updatePostBody(params.id, text);
  await logAuditEvent({
    action: "education.discussion.edit",
    userId: auth.user.sub,
    targetId: params.id,
    request,
  });
  return Response.json(updated);
}
