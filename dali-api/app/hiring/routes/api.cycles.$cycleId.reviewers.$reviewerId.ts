import type { Route } from "./+types/api.cycles.$cycleId.reviewers.$reviewerId";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { withCors, handlePreflight } from "~/lib/cors";
import { idSchema, parseJson } from "~/lib/validate";

const PatchReviewerSchema = z.object({
  domainId: idSchema.optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;

  if (request.method === "PATCH") {
    const body = await parseJson(request, PatchReviewerSchema);
    if (body instanceof Response) return withCors(request, body);
    const reviewer = await prisma.cycleReviewer.update({
      where: { id: params.reviewerId },
      data: {
        domainId: body.domainId,
      },
      include: {
        user: true,
        domain: true,
      },
    });
    await logAuditEvent({
      action: "reviewer.update",
      userId: gate.auth.user.sub,
      targetId: reviewer.id,
      metadata: {
        cycleId: params.cycleId!,
        reviewerUserId: reviewer.userId,
        domainId: reviewer.domainId,
      },
      request,
    });
    return withCors(request, Response.json(reviewer));
  }

  if (request.method === "DELETE") {
    // ApplicationReview FK to CycleReviewer is non-cascading (audit-bearing).
    // The confirm dialog already promises that any reviews this reviewer has
    // for this cycle will be deleted, so we cascade explicitly in a tx.
    let removed: { userId: string; domainId: string; reviewCount: number } | null = null;
    try {
      removed = await prisma.$transaction(async (tx) => {
        const { count } = await tx.applicationReview.deleteMany({
          where: { cycleReviewerId: params.reviewerId },
        });
        const reviewer = await tx.cycleReviewer.delete({
          where: { id: params.reviewerId },
          select: { userId: true, domainId: true },
        });
        return { ...reviewer, reviewCount: count };
      });
    } catch (e: any) {
      if (e?.code === "P2025") {
        return withCors(request, Response.json({ error: "Reviewer not found" }, { status: 404 }));
      }
      return withCors(request, Response.json({ error: "Failed to remove reviewer" }, { status: 500 }));
    }
    await logAuditEvent({
      action: "reviewer.remove",
      userId: gate.auth.user.sub,
      targetId: params.reviewerId!,
      metadata: {
        cycleId: params.cycleId!,
        reviewerUserId: removed.userId,
        domainId: removed.domainId,
        deletedReviews: removed.reviewCount,
      },
      request,
    });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
