import type { Route } from "./+types/api.cycles.$cycleId.reviewers";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, hasCycleAccess } from "~/lib/roles";
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
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  const reviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      daliMember: { include: { user: true } },
      domain: true,
    },
  });

  return withAuth(auth, withCors(request, Response.json(reviewers)));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const body = await parseJson(request, CreateReviewerSchema);
  if (body instanceof Response) return withAuth(auth, withCors(request, body));
  const { daliMemberId, domainId } = body;

  // Authority gate: hiring leads can add reviewers in any domain; domain leads
  // can only add reviewers in domains they actually lead. Interviewers are
  // handled separately.
  const hiringLead = await isHiringLead(auth.user.sub);
  if (!hiringLead) {
    const callerMember = await prisma.dALIMember.findFirst({
      where: { userId: auth.user.sub },
      select: { domainLeadAssignments: { where: { domainId }, select: { id: true } } },
    });
    const leadsThisDomain = (callerMember?.domainLeadAssignments.length ?? 0) > 0;
    if (!leadsThisDomain) {
      return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));
    }
  }

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

  return withAuth(auth, withCors(request, Response.json(reviewer, { status: 201 })));
}
