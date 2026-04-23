import type { Route } from "./+types/api.reviews.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
    include: { cycleReviewer: true },
  });
  if (!review) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    if (review.submittedAt) {
      return Response.json({ error: "Cannot edit a submitted review. Unsubmit first." }, { status: 409 });
    }

    const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
    const isOwner = member && review.cycleReviewer.daliMemberId === member.id;
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isHiringLead(auth.user.sub);
    if (!isOwner && !isLead && !isHL) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.scores !== undefined) data.scores = body.scores;
    if (body.feedback !== undefined) data.feedback = body.feedback;
    if (body.rejectionRationale !== undefined) data.rejectionRationale = body.rejectionRationale;
    if (body.overallRecommendation !== undefined) data.overallRecommendation = body.overallRecommendation;
    if (body.annotations !== undefined) data.annotations = body.annotations;

    const updated = await prisma.applicationReview.update({
      where: { id: params.id },
      data,
    });

    return Response.json(updated);
  }

  if (request.method === "DELETE") {
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isHiringLead(auth.user.sub);
    if (!isLead && !isHL) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Submitted reviews are allowed to be deleted by domain/hiring leads —
    // the client is expected to confirm with the user first since this
    // destroys the submitted scores/feedback.
    await prisma.applicationReview.delete({ where: { id: params.id } });
    return Response.json({ deleted: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
