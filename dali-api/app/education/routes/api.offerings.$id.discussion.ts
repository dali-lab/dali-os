import type { Route } from "./+types/api.offerings.$id.discussion";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { createPost } from "~/education/lib/discussions-data";
import { notifyDiscussionPost } from "~/education/lib/discussions-notifications";
import { resolveMentions } from "~/education/lib/mentions";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Posting requires Approved enrollment OR being able to manage the offering.
  const isManager = await canManageOffering(auth.user.sub, params.id);
  if (!isManager) {
    const app = await prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: auth.user.sub,
          offeringId: params.id,
        },
      },
      select: { status: true },
    });
    if (!app || app.status !== "Approved") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return Response.json({ error: "body required" }, { status: 400 });

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return Response.json({ error: "Offering not found" }, { status: 404 });

  try {
    const { created, topLevelId, isFromInstructor } = await createPost({
      offeringId: params.id,
      authorId: auth.user.sub,
      body: text,
      parentPostId: typeof body.parentPostId === "string" ? body.parentPostId : null,
    });

    try {
      const author = `${created.author.firstName ?? ""} ${created.author.lastName ?? ""}`.trim() || "Someone";
      const mentions = await resolveMentions(text, params.id);
      await notifyDiscussionPost({
        offeringId: params.id,
        offeringTitle: offering.title,
        postId: topLevelId,
        authorUserId: auth.user.sub,
        authorName: author,
        bodyPreview: text,
        isFromInstructor,
        isReply: !!created.parentPostId,
        enrolledLink: `/education/enrolled/${params.id}#post-${topLevelId}`,
        forceRecipients: mentions.map((m) => m.userId),
      });
    } catch (err) {
      console.error("[education-discussions] notify failed:", err);
    }

    await logAuditEvent({
      action: "education.discussion.post",
      userId: auth.user.sub,
      targetId: created.id,
      metadata: {
        offeringId: params.id,
        isReply: !!created.parentPostId,
        topLevelId,
      },
      request,
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Post failed" },
      { status: 400 },
    );
  }
}
