import type { Route } from "./+types/api.domain-applications.$id.reviews";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const reviews = await prisma.applicationReview.findMany({
    where: { domainApplicationId: params.id },
    include: {
      cycleReviewer: {
        include: {
          daliMember: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(reviews);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { cycleReviewerId } = body;

  if (!cycleReviewerId) {
    return Response.json({ error: "cycleReviewerId is required" }, { status: 400 });
  }

  const domainApp = await prisma.domainApplication.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      application: true,
      challengeVersion: { select: { domainId: true } },
    },
  });

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: domainApp.application.applicationCycleId },
  });
  if (!cycle.generalRubricVersionId) {
    return Response.json({ error: "A general application rubric must be set before assigning reviewers to applications" }, { status: 400 });
  }

  const domainCycle = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId: domainApp.challengeVersion.domainId, applicationCycleId: cycle.id } },
  });
  if (!domainCycle?.rubricVersionId) {
    return Response.json({ error: "A domain rubric must be set before assigning reviewers to applications in this domain" }, { status: 400 });
  }

  const review = await prisma.applicationReview.create({
    data: {
      domainApplicationId: params.id,
      cycleReviewerId,
    },
  });

  return Response.json(review, { status: 201 });
}
