import type { Route } from "./+types/api.domain-applications.$id.reviews";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, hasCycleAccess } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const CreateReviewSchema = z.object({
  cycleReviewerId: z.string().min(1).max(100),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const domainApp = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    select: { application: { select: { applicationCycleId: true } } },
  });
  if (!domainApp) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await hasCycleAccess(auth.user.sub, domainApp.application.applicationCycleId)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    domainApp.application.applicationCycleId,
  );
  if (gate) return gate;

  const reviews = await prisma.applicationReview.findMany({
    where: { domainApplicationId: params.id },
    include: {
      cycleReviewer: {
        include: {
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
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

  const body = await parseJson(request, CreateReviewSchema);
  if (body instanceof Response) return body;
  const { cycleReviewerId } = body;

  const domainApp = await prisma.domainApplication.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      application: true,
      challengeVersion: { select: { domainId: true } },
      // InternToFull links Domain directly; needed when challengeVersion is null.
      domain: { select: { id: true } },
    },
  });

  // Refuse to assign reviewers to a domain the applicant deselected — the
  // record only persists to preserve answers in case they re-select.
  if (!domainApp.selected) {
    return Response.json({ error: "Cannot assign reviewer to a deselected domain application" }, { status: 409 });
  }

  // ChallengeVersion.domainId is nullable because the general application form
  // is also a ChallengeVersion. A DomainApplication should never reference one,
  // so this is a data invariant error rather than a user-facing condition.
  // InternToFull DomainApplications link Domain directly instead of via a
  // ChallengeVersion, so fall back to the direct relation when it's set.
  const domainId = domainApp.challengeVersion?.domainId ?? domainApp.domainId;
  if (!domainId) {
    return Response.json({ error: "Domain application is linked to a non-domain challenge version" }, { status: 500 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    domainApp.application.applicationCycleId,
  );
  if (gate) return gate;

  if (!(await isCore(auth.user.sub))) {
    const domainLead = await prisma.domainLeadAssignment.findFirst({
      where: { userId: auth.user.sub, domainId },
      select: { id: true },
    });
    if (!domainLead) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: domainApp.application.applicationCycleId },
  });
  if (!cycle.generalRubricVersionId) {
    return Response.json({ error: "A general application rubric must be set before assigning reviewers to applications" }, { status: 400 });
  }

  // InternToFull cycles use only the cycle-level general rubric; per-domain
  // rubrics aren't part of that flow, so skip the per-domain check.
  if (cycle.cycleType !== "InternToFull") {
    const domainCycle = await prisma.domainApplicationCycle.findUnique({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycle.id } },
    });
    if (!domainCycle?.rubricVersionId) {
      return Response.json({ error: "A domain rubric must be set before assigning reviewers to applications in this domain" }, { status: 400 });
    }
  }

  const review = await prisma.applicationReview.create({
    data: {
      domainApplicationId: params.id,
      cycleReviewerId,
    },
  });

  return Response.json(review, { status: 201 });
}
