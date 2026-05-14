import type { Route } from "./+types/api.cycles.$cycleId.domains.$domainId.auto-assign";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";

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

  const { cycleId, domainId } = params;

  const gate = await requireApiSignedOrForbidden(auth.user.sub, cycleId!);
  if (gate) return gate;

  // Optional subset filter: when present, auto-assignment is restricted to
  // these DomainApplication ids. Used by the bulk-assign toolbar so a domain
  // lead can fill reviewer slots on just the rows they've selected. When
  // absent (the original behavior), every Submitted application qualifies.
  let applicationIdsFilter: string[] | null = null;
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await request.json().catch(() => null) as { applicationIds?: unknown } | null;
    if (body && Array.isArray(body.applicationIds)) {
      const ids = body.applicationIds.filter((v): v is string => typeof v === "string" && v.length > 0);
      applicationIdsFilter = ids;
    }
  }

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId! },
  });
  if (!cycle.generalRubricVersionId) {
    return Response.json({ error: "A general application rubric must be set before assigning reviewers to applications" }, { status: 400 });
  }

  const domainCycle = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId: domainId!, applicationCycleId: cycleId! } },
  });
  if (!domainCycle) {
    return Response.json({ error: "Domain not part of this cycle" }, { status: 404 });
  }
  if (!domainCycle.rubricVersionId) {
    return Response.json({ error: "A domain rubric must be set before assigning reviewers to applications" }, { status: 400 });
  }

  const targetCount = domainCycle.reviewersPerApplication;

  const reviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: cycleId!, domainId: domainId! },
    include: { reviews: { select: { id: true } } },
  });

  if (reviewers.length === 0) {
    return Response.json({ error: "No reviewers assigned to this domain" }, { status: 400 });
  }

  const domainApps = await prisma.domainApplication.findMany({
    where: {
      selected: true,
      challengeVersion: { domainId: domainId! },
      application: {
        applicationCycleId: cycleId!,
        ...inReviewPipelineFilter,
      },
      ...(applicationIdsFilter && applicationIdsFilter.length > 0
        ? { id: { in: applicationIdsFilter } }
        : {}),
    },
    include: {
      reviews: { select: { cycleReviewerId: true } },
    },
  });

  // Track how many reviews each reviewer has (including existing ones)
  const reviewerLoad = new Map<string, number>();
  for (const r of reviewers) {
    reviewerLoad.set(r.id, r.reviews.length);
  }

  let assigned = 0;

  for (const da of domainApps) {
    const existingReviewerIds = new Set(da.reviews.map((r) => r.cycleReviewerId));
    const needed = targetCount - existingReviewerIds.size;
    if (needed <= 0) continue;

    // Pick reviewers with the lowest load, excluding already-assigned ones
    const candidates = reviewers
      .filter((r) => !existingReviewerIds.has(r.id))
      .sort((a, b) => (reviewerLoad.get(a.id) ?? 0) - (reviewerLoad.get(b.id) ?? 0));

    const toAssign = candidates.slice(0, needed);

    for (const reviewer of toAssign) {
      await prisma.applicationReview.create({
        data: {
          domainApplicationId: da.id,
          cycleReviewerId: reviewer.id,
        },
      });
      reviewerLoad.set(reviewer.id, (reviewerLoad.get(reviewer.id) ?? 0) + 1);
      assigned++;
    }
  }

  return Response.json({ assigned });
}
