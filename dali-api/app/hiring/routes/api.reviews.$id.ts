import type { Route } from "./+types/api.reviews.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { ReviewPatchSchema } from "~/hiring/lib/review";

// Re-exported so existing tests can import it from this route module.
export { validateReviewPatch } from "~/hiring/lib/review";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const review = await prisma.applicationReview.findUnique({
    where: { id: params.id },
    include: {
      cycleReviewer: true,
      domainApplication: {
        select: {
          domainId: true,
          challengeVersion: { select: { domainId: true } },
          application: { select: { applicationCycleId: true } },
        },
      },
    },
  });
  if (!review) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    review.cycleReviewer.applicationCycleId,
  );
  if (gate) return gate;

  if (request.method === "PATCH") {
    if (review.submittedAt) {
      return Response.json({ error: "Cannot edit a submitted review. Unsubmit first." }, { status: 409 });
    }

    const isOwner = review.cycleReviewer.userId === auth.user.sub;
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isCore(auth.user.sub);
    if (!isOwner && !isLead && !isHL) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJson(request, ReviewPatchSchema);
    if (parsed instanceof Response) return parsed;

    // When scores are written, pin the domain rubric version those keys belong
    // to so a later rubric edit can't orphan them at render time. Only the
    // domain rubric is pinned (its criteria are the crit-<ts> keys that drift);
    // the general-form rubric is resolved separately by consumers.
    const patch: typeof parsed & { rubricVersionId?: string } = { ...parsed };
    const da = review.domainApplication;
    if (parsed.scores !== undefined && !review.rubricVersionId && da) {
      const domainId = da.domainId ?? da.challengeVersion?.domainId ?? null;
      const applicationCycleId = da.application?.applicationCycleId ?? null;
      if (domainId && applicationCycleId) {
        const dac = await prisma.domainApplicationCycle.findUnique({
          where: {
            domainId_applicationCycleId: { domainId, applicationCycleId },
          },
          select: { rubricVersionId: true },
        });
        if (dac?.rubricVersionId) patch.rubricVersionId = dac.rubricVersionId;
      }
    }

    const updated = await prisma.applicationReview.update({
      where: { id: params.id },
      data: patch,
    });

    return Response.json(updated);
  }

  if (request.method === "DELETE") {
    const isLead = await isDomainLead(auth.user.sub);
    const isHL = await isCore(auth.user.sub);
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
