import type { Route } from "./+types/api.reviews.$id.submit";
import { prisma } from "~/lib/db";
import { requireMemberSession } from "~/lib/auth";
import { isCycleAdmin, isDomainLeadForCycle } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const memberGate = await requireMemberSession(request);
  if (!memberGate.ok) return memberGate.response;
  const auth = memberGate.auth;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
    include: { cycleReviewer: true },
  });
  if (!review) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  if (review.submittedAt) {
    return Response.json({ error: "Review already submitted" }, { status: 409 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  if (gate) return gate;

  const isOwner = review.cycleReviewer.userId === auth.user.sub;
  const isLead = await isDomainLeadForCycle(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  const isHL = await isCycleAdmin(auth.user.sub, review.cycleReviewer.applicationCycleId);
  if (!isOwner && !isLead && !isHL) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.applicationReview.update({
    where: { id: params.id },
    data: {
      submittedAt: new Date(),
      submittedById: auth.user.sub,
    },
  });

  await logAuditEvent({
    action: "review.submit",
    userId: auth.user.sub,
    targetId: review.id,
    metadata: {
      cycleId: review.cycleReviewer.applicationCycleId,
      reviewerUserId: review.cycleReviewer.userId,
    },
    request,
  });

  return Response.json(updated);
}
