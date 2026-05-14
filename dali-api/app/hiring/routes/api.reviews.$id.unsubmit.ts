import type { Route } from "./+types/api.reviews.$id.unsubmit";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

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
  if (!review.submittedAt) {
    return Response.json({ error: "Review is not submitted" }, { status: 409 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  if (gate) return gate;

  const isOwner = review.cycleReviewer.userId === auth.user.sub;
  const isLead = await isDomainLead(auth.user.sub);
  const isHL = await isHiringLead(auth.user.sub);
  if (!isOwner && !isLead && !isHL) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.applicationReview.update({
    where: { id: params.id },
    data: {
      submittedAt: null,
      submittedById: null,
    },
  });

  return Response.json(updated);
}
