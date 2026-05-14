import type { Route } from "./+types/api.cycles.$cycleId.reviewers.$reviewerId";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const PatchReviewerSchema = z.object({
  domainId: z.string().min(1).max(100).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

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
    return withCors(request, Response.json(reviewer));
  }

  if (request.method === "DELETE") {
    // ApplicationReview FK to CycleReviewer is non-cascading (audit-bearing).
    // The confirm dialog already promises that any reviews this reviewer has
    // for this cycle will be deleted, so we cascade explicitly in a tx.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.applicationReview.deleteMany({
          where: { cycleReviewerId: params.reviewerId },
        });
        await tx.cycleReviewer.delete({
          where: { id: params.reviewerId },
        });
      });
    } catch (e: any) {
      if (e?.code === "P2025") {
        return withCors(request, Response.json({ error: "Reviewer not found" }, { status: 404 }));
      }
      return withCors(request, Response.json({ error: "Failed to remove reviewer" }, { status: 500 }));
    }
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
