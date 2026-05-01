import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/analytics";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { getReviewStatus } from "~/hiring/lib/review-status";
import { StatCard } from "~/components/analytics/StatCard";
import { CycleSelector } from "~/components/analytics/CycleSelector";
import { DomainFilter } from "~/components/analytics/DomainFilter";
import { FunnelChart } from "~/components/analytics/FunnelChart";
import { ReviewProgressChart } from "~/components/analytics/ReviewProgressChart";
import { DecisionBreakdownChart } from "~/components/analytics/DecisionBreakdownChart";
import { InterviewPipelineChart } from "~/components/analytics/InterviewPipelineChart";
import { ReviewerWorkloadChart } from "~/components/analytics/ReviewerWorkloadChart";
import { TimelineChart } from "~/components/analytics/TimelineChart";

export const meta: Route.MetaFunction = () => [{ title: "Analytics · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isHiringLead && !roles.isDomainLead) return withAuth(auth, redirect("/"));

  // Resolve user's assigned domains (for default filter + domain-lead-only access)
  let userDomainIds: string[] = [];
  if (roles.isDomainLead && roles.memberId) {
    const assignments = await prisma.domainLeadAssignment.findMany({
      where: { memberId: roles.memberId },
      select: { domainId: true },
    });
    userDomainIds = assignments.map((a) => a.domainId);
  }

  // Domain-lead-only users must have at least one assignment
  if (!roles.isHiringLead && userDomainIds.length === 0) {
    return withAuth(auth, redirect("/"));
  }

  // Load all cycles for the selector
  const allCycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domains: { select: { domainId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const cycles = allCycles.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.statusUpdates[0]?.newStatus ?? "Draft",
  }));

  const emptyData = {
    cycles,
    selectedCycleId: "",
    cycleStatus: "",
    isHiringLead: roles.isHiringLead,
    allDomains: [] as Array<{ id: string; name: string }>,
    selectedDomainIds: [] as string[],
    userDomainIds,
    kpis: { totalApplications: 0, totalSubmitted: 0, totalDomainApplications: 0, reviewsCompleted: 0, reviewsTotal: 0, interviewsScheduled: 0, interviewsCompleted: 0, decisionsReleased: 0 },
    funnel: [],
    reviewProgress: { byStatus: { notStarted: 0, inProgress: 0, submitted: 0 }, byRecommendation: {}, byReviewer: [] },
    decisions: { byDomain: [], byStage: { draft: 0, final: 0, released: 0 } },
    interviews: { scheduled: 0, completed: 0, cancelled: 0, pendingInvite: 0 },
    timeline: [],
  };

  if (cycles.length === 0) return withAuth(auth, emptyData);

  // Pick selected cycle
  const url = new URL(request.url);
  const requestedCycleId = url.searchParams.get("cycleId");
  const selectedCycle =
    (requestedCycleId ? cycles.find((c) => c.id === requestedCycleId) : null) ??
    cycles.find((c) => ["Open", "UnderReview"].includes(c.status)) ??
    cycles[0];

  const cycleId = selectedCycle.id;

  // Load all domains in this cycle (for the filter UI)
  const cycleDomains = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: cycleId },
    include: { domain: { select: { id: true, name: true } } },
  });
  const allDomains = cycleDomains.map((d) => ({ id: d.domain.id, name: d.domain.name }));

  // Resolve domain filter from URL, with smart defaults
  const domainsParam = url.searchParams.get("domains");
  let domainIds: string[] | null = null; // null = all domains
  if (domainsParam) {
    // Explicit filter from URL — intersect with available domains
    const requested = domainsParam.split(",").filter(Boolean);
    const available = new Set(allDomains.map((d) => d.id));
    const valid = requested.filter((id) => available.has(id));
    if (valid.length > 0) domainIds = valid;
  } else if (!roles.isHiringLead && userDomainIds.length > 0) {
    // Domain-lead-only defaults to their assigned domains
    domainIds = userDomainIds;
  }
  // Hiring leads (including dual-role) default to null = all domains

  const selectedDomainIds = domainIds ?? allDomains.map((d) => d.id);

  // Domain filter for Prisma queries
  const domainFilter = domainIds ? { domainId: { in: domainIds } } : {};
  const cvDomainFilter = domainIds ? { challengeVersion: { domainId: { in: domainIds } } } : {};

  // ─── Parallel data fetch ───────────────────────────────────────────────────
  // Filtered domains for aggregation (subset of allDomains based on filter)
  const domains = domainIds
    ? cycleDomains.filter((d) => domainIds!.includes(d.domain.id))
    : cycleDomains;

  const [applications, reviews, interviewRows] = await Promise.all([
    // 1. Applications with domain applications, reviews, decisions, interviews
    prisma.application.findMany({
      where: { applicationCycleId: cycleId },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domainApplications: {
          where: { selected: true, ...cvDomainFilter },
          include: {
            challengeVersion: { select: { domainId: true } },
            reviews: {
              select: {
                submittedAt: true,
                feedback: true,
                rejectionRationale: true,
                overallRecommendation: true,
                scores: true,
                annotations: true,
                cycleReviewer: {
                  select: { daliMember: { select: { firstName: true, lastName: true } } },
                },
              },
            },
            decisions: { orderBy: { createdAt: "desc" } },
            interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
          },
        },
      },
    }),

    // 3. All reviews for reviewer workload (need cycleReviewer info)
    prisma.applicationReview.findMany({
      where: {
        cycleReviewer: { applicationCycleId: cycleId, ...domainFilter },
      },
      select: {
        submittedAt: true,
        feedback: true,
        rejectionRationale: true,
        overallRecommendation: true,
        scores: true,
        annotations: true,
        cycleReviewer: {
          select: { daliMember: { select: { firstName: true, lastName: true } } },
        },
      },
    }),

    // 4. All interviews for pipeline
    prisma.interview.findMany({
      where: {
        applicationCycleId: cycleId,
        ...(domainIds ? { domainApplication: { challengeVersion: { domainId: { in: domainIds } } } } : {}),
      },
      select: { status: true },
    }),
  ]);

  // ─── Build domain name map ─────────────────────────────────────────────────
  const domainNameMap = new Map(domains.map((d) => [d.domain.id, d.domain.name]));

  // ─── Aggregate: Applications ───────────────────────────────────────────────
  const submittedApps = applications.filter(
    (a) => a.statusUpdates[0]?.newStatus === "Submitted"
  );
  const allDAs = applications.flatMap((a) => a.domainApplications);

  // ─── Aggregate: Funnel per domain ──────────────────────────────────────────
  type FunnelRow = {
    domain: string;
    submitted: number;
    reviewed: number;
    interviewed: number;
    accepted: number;
    rejected: number;
    waitlisted: number;
    pending: number;
  };

  const funnelMap = new Map<string, FunnelRow>();
  for (const d of domains) {
    funnelMap.set(d.domain.id, {
      domain: d.domain.name,
      submitted: 0,
      reviewed: 0,
      interviewed: 0,
      accepted: 0,
      rejected: 0,
      waitlisted: 0,
      pending: 0,
    });
  }

  let reviewsCompleted = 0;
  let reviewsTotal = 0;
  let decisionsReleased = 0;

  for (const app of submittedApps) {
    for (const da of app.domainApplications) {
      const did = da.challengeVersion.domainId;
      if (!did) continue;
      const row = funnelMap.get(did);
      if (!row) continue;

      row.submitted++;
      reviewsTotal += da.reviews.length;

      const allReviewsSubmitted =
        da.reviews.length > 0 && da.reviews.every((r) => r.submittedAt);
      if (allReviewsSubmitted) row.reviewed++;
      reviewsCompleted += da.reviews.filter((r) => r.submittedAt).length;

      const hasCompletedInterview = da.interviews.some((i) => i.status === "Completed");
      if (hasCompletedInterview) row.interviewed++;

      // Latest decision
      const latestDecision = da.decisions[0];
      if (latestDecision?.stage === "Released") {
        decisionsReleased++;
        switch (latestDecision.type) {
          case "Accepted":
            row.accepted++;
            break;
          case "Rejected":
            row.rejected++;
            break;
          case "Waitlisted":
            row.waitlisted++;
            break;
          default:
            row.pending++;
        }
      } else {
        row.pending++;
      }
    }
  }

  const funnel = Array.from(funnelMap.values());

  // ─── Aggregate: Review progress ────────────────────────────────────────────
  const reviewStatusCounts = { notStarted: 0, inProgress: 0, submitted: 0 };
  const recommendationCounts: Record<string, number> = {};
  const reviewerMap = new Map<string, { name: string; assigned: number; completed: number }>();

  for (const review of reviews) {
    const status = getReviewStatus(review);
    reviewStatusCounts[status]++;

    if (review.overallRecommendation && review.submittedAt) {
      recommendationCounts[review.overallRecommendation] =
        (recommendationCounts[review.overallRecommendation] ?? 0) + 1;
    }

    const member = review.cycleReviewer.daliMember;
    const name = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "Unknown";
    const existing = reviewerMap.get(name);
    if (existing) {
      existing.assigned++;
      if (review.submittedAt) existing.completed++;
    } else {
      reviewerMap.set(name, { name, assigned: 1, completed: review.submittedAt ? 1 : 0 });
    }
  }

  // ─── Aggregate: Decisions by domain + stage ────────────────────────────────
  const decisionsByDomainMap = new Map<
    string,
    { domain: string; accepted: number; rejected: number; waitlisted: number; invitedToInterview: number; pending: number }
  >();
  for (const d of domains) {
    decisionsByDomainMap.set(d.domain.id, {
      domain: d.domain.name,
      accepted: 0,
      rejected: 0,
      waitlisted: 0,
      invitedToInterview: 0,
      pending: 0,
    });
  }
  const decisionStageCounts = { draft: 0, final: 0, released: 0 };

  for (const app of submittedApps) {
    for (const da of app.domainApplications) {
      const did = da.challengeVersion.domainId;
      if (!did) continue;
      const row = decisionsByDomainMap.get(did);
      if (!row) continue;

      const latest = da.decisions[0];
      if (!latest) {
        row.pending++;
        continue;
      }

      // Count stage
      switch (latest.stage) {
        case "Draft":
          decisionStageCounts.draft++;
          break;
        case "Final":
          decisionStageCounts.final++;
          break;
        case "Released":
          decisionStageCounts.released++;
          break;
      }

      // Count type (using latest decision regardless of stage)
      switch (latest.type) {
        case "Accepted":
          row.accepted++;
          break;
        case "Rejected":
          row.rejected++;
          break;
        case "Waitlisted":
          row.waitlisted++;
          break;
        case "InvitedToInterview":
          row.invitedToInterview++;
          break;
      }
    }
  }

  // ─── Aggregate: Interview pipeline ─────────────────────────────────────────
  const interviewCounts = { scheduled: 0, completed: 0, cancelled: 0 };
  for (const iv of interviewRows) {
    if (iv.status === "Scheduled") interviewCounts.scheduled++;
    else if (iv.status === "Completed") interviewCounts.completed++;
    else interviewCounts.cancelled++;
  }

  // Count DAs with InvitedToInterview released decision but no scheduled/completed interview
  let pendingInvite = 0;
  for (const app of submittedApps) {
    for (const da of app.domainApplications) {
      const latest = da.decisions[0];
      if (
        latest?.type === "InvitedToInterview" &&
        latest.stage === "Released" &&
        !da.interviews.some((i) => i.status === "Scheduled" || i.status === "Completed")
      ) {
        pendingInvite++;
      }
    }
  }

  // ─── Aggregate: Timeline ───────────────────────────────────────────────────
  const timelineBuckets = new Map<string, { submissions: number; reviewsCompleted: number }>();

  for (const app of applications) {
    const statusUpdate = app.statusUpdates[0];
    if (statusUpdate?.newStatus === "Submitted") {
      const dateKey = new Date(statusUpdate.createdAt).toISOString().slice(0, 10);
      const bucket = timelineBuckets.get(dateKey) ?? { submissions: 0, reviewsCompleted: 0 };
      bucket.submissions++;
      timelineBuckets.set(dateKey, bucket);
    }
  }

  for (const review of reviews) {
    if (review.submittedAt) {
      const dateKey = new Date(review.submittedAt).toISOString().slice(0, 10);
      const bucket = timelineBuckets.get(dateKey) ?? { submissions: 0, reviewsCompleted: 0 };
      bucket.reviewsCompleted++;
      timelineBuckets.set(dateKey, bucket);
    }
  }

  const timeline = Array.from(timelineBuckets.entries())
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ─── Return ────────────────────────────────────────────────────────────────
  return withAuth(auth, {
    cycles,
    selectedCycleId: cycleId,
    cycleStatus: selectedCycle.status,
    isHiringLead: roles.isHiringLead,
    allDomains,
    selectedDomainIds,
    userDomainIds,
    kpis: {
      totalApplications: applications.length,
      totalSubmitted: submittedApps.length,
      totalDomainApplications: allDAs.length,
      reviewsCompleted,
      reviewsTotal,
      interviewsScheduled: interviewCounts.scheduled,
      interviewsCompleted: interviewCounts.completed,
      decisionsReleased,
    },
    funnel,
    reviewProgress: {
      byStatus: reviewStatusCounts,
      byRecommendation: recommendationCounts,
      byReviewer: Array.from(reviewerMap.values()).sort((a, b) => b.assigned - a.assigned),
    },
    decisions: {
      byDomain: Array.from(decisionsByDomainMap.values()),
      byStage: decisionStageCounts,
    },
    interviews: {
      ...interviewCounts,
      pendingInvite,
    },
    timeline,
  });
}

export default function AnalyticsDashboard() {
  const data = useLoaderData<typeof loader>() as any;

  if (!data.cycles || data.cycles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No hiring cycles found.
      </div>
    );
  }

  const { kpis, reviewProgress, funnel, decisions, interviews, timeline } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <CycleSelector cycles={data.cycles} selectedCycleId={data.selectedCycleId} />
      </div>

      {/* Domain filter */}
      {data.allDomains.length > 1 && (
        <DomainFilter
          allDomains={data.allDomains}
          selectedDomainIds={data.selectedDomainIds}
          userDomainIds={data.userDomainIds}
        />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Applications"
          value={kpis.totalSubmitted}
          subtitle={`${kpis.totalDomainApplications} domain applications`}
        />
        <StatCard
          label="Reviews Done"
          value={kpis.reviewsCompleted}
          subtitle={`of ${kpis.reviewsTotal} assigned`}
          color={kpis.reviewsCompleted === kpis.reviewsTotal && kpis.reviewsTotal > 0 ? "text-green-600" : undefined}
        />
        <StatCard
          label="Interviews"
          value={kpis.interviewsCompleted}
          subtitle={`${kpis.interviewsScheduled} scheduled`}
        />
        <StatCard
          label="Decisions Released"
          value={kpis.decisionsReleased}
          subtitle={`of ${kpis.totalDomainApplications} total`}
          color={kpis.decisionsReleased === kpis.totalDomainApplications && kpis.totalDomainApplications > 0 ? "text-green-600" : undefined}
        />
      </div>

      {/* Main grid: 2/3 + 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          <ChartCard title="Application Funnel">
            <FunnelChart data={funnel} />
          </ChartCard>

          <ChartCard title="Decision Distribution">
            <DecisionBreakdownChart data={decisions.byDomain} />
          </ChartCard>

          <ChartCard title="Activity Timeline">
            <TimelineChart data={timeline} />
          </ChartCard>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <ChartCard title="Review Status">
            <ReviewProgressChart
              byStatus={reviewProgress.byStatus}
              byRecommendation={reviewProgress.byRecommendation}
            />
          </ChartCard>

          <ChartCard title="Interview Pipeline">
            <InterviewPipelineChart data={interviews} />
          </ChartCard>
        </div>
      </div>

      {/* Full-width reviewer workload */}
      <ChartCard title="Reviewer Workload">
        <ReviewerWorkloadChart data={reviewProgress.byReviewer} />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">{title}</h3>
      {children}
    </div>
  );
}
