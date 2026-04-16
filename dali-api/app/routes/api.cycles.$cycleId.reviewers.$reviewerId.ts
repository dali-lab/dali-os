import type { Route } from "./+types/api.cycles.$cycleId.reviewers.$reviewerId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isHiringLead(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method === "PATCH") {
    const body = await request.json();
    const reviewer = await prisma.cycleReviewer.update({
      where: { id: params.reviewerId },
      data: {
        domainId: body.domainId,
      },
      include: {
        daliMember: { include: { user: true } },
        domain: true,
      },
    });
    return withCors(request, Response.json(reviewer));
  }

  if (request.method === "DELETE") {
    await prisma.cycleReviewer.delete({
      where: { id: params.reviewerId },
    });
    return withCors(request, Response.json({ ok: true }));
  }

  return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
}
