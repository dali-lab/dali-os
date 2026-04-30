import type { Route } from "./+types/api.reviews.$id.unsubmit";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/lib/confidentiality";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
    include: { cycleReviewer: true },
  });
  if (!review) {
    return withAuth(auth, Response.json({ error: "Review not found" }, { status: 404 }));
  }
  if (!review.submittedAt) {
    return withAuth(auth, Response.json({ error: "Review is not submitted" }, { status: 409 }));
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  if (gate) return gate;

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  const isOwner = member && review.cycleReviewer.daliMemberId === member.id;
  const isLead = await isDomainLead(auth.user.sub);
  const isHL = await isHiringLead(auth.user.sub);
  if (!isOwner && !isLead && !isHL) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const updated = await prisma.applicationReview.update({
    where: { id: params.id },
    data: {
      submittedAt: null,
      submittedById: null,
    },
  });

  return withAuth(auth, Response.json(updated));
}
