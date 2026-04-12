import type { Route } from "./+types/api.cycles.$cycleId.reviewers";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const reviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      daliMember: { include: { user: true } },
      domain: true,
    },
  });

  return withCors(request, Response.json(reviewers));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await request.json();
  const { daliMemberId, domainId, isLead } = body;

  if (!daliMemberId || !domainId) {
    return withCors(request, Response.json({ error: "daliMemberId and domainId required" }, { status: 400 }));
  }

  const reviewer = await prisma.cycleReviewer.create({
    data: {
      daliMemberId,
      applicationCycleId: params.cycleId,
      domainId,
      isLead: isLead ?? false,
    },
    include: {
      daliMember: { include: { user: true } },
      domain: true,
    },
  });

  return withCors(request, Response.json(reviewer, { status: 201 }));
}
