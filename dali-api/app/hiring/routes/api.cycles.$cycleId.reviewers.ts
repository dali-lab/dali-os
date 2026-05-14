import type { Route } from "./+types/api.cycles.$cycleId.reviewers";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

const CreateReviewerSchema = z.object({
  daliMemberId: z.string().min(1).max(100),
  domainId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

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
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateReviewerSchema);
  if (body instanceof Response) return withCors(request, body);
  const { daliMemberId, domainId } = body;

  // Ensure domain is linked to cycle
  await prisma.domainApplicationCycle.upsert({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.cycleId! } },
    update: {},
    create: { domainId, applicationCycleId: params.cycleId! },
  });

  const reviewer = await prisma.cycleReviewer.create({
    data: {
      daliMemberId,
      applicationCycleId: params.cycleId,
      domainId,
    },
    include: {
      daliMember: { include: { user: true } },
      domain: true,
    },
  });

  return withCors(request, Response.json(reviewer, { status: 201 }));
}
