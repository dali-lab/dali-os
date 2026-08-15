import { prisma } from "~/lib/db";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "./domain-application-status";
import { getCycleConfidentialityState } from "./confidentiality";
import type { DomainApplicationStatus } from "~/types";
import type { StatusSlice } from "~/hiring/components/analytics/StatusPie";
import type { ApplicationRow } from "~/hiring/components/analytics/ApplicationList";
import type { PipelineData } from "~/hiring/components/analytics/PipelinePanel";

// Data for the hub's pipeline section (formerly the /hiring/analytics page):
// per-cycle status distribution + drill-down rows, driven by ?cycleId=,
// ?domain= and ?status= search params. Caller is responsible for gating to
// Core / DomainLead.

// Adds an "InProgress" bucket on top of `DomainApplicationStatus` for domain
// applications whose owner has never submitted (post-process override).
type AnalyticsStatus = DomainApplicationStatus | "InProgress";

const STATUS_LABELS: Record<AnalyticsStatus, string> = {
  ApplicationOpen: "Application Open",
  InProgress: "In Progress",
  Pending: "Pending",
  InvitedToInterview: "Invited to Interview",
  InterviewScheduled: "Interview Scheduled",
  PostInterviewPending: "Post-Interview",
  Withdrawn: "Withdrawn",
  Accepted: "Accepted",
  Rejected: "Rejected",
  Waitlisted: "Waitlisted",
};

// Display order for the pie/legend.
const STATUS_ORDER: AnalyticsStatus[] = [
  "InProgress",
  "Pending",
  "InvitedToInterview",
  "InterviewScheduled",
  "PostInterviewPending",
  "Accepted",
  "Waitlisted",
  "Rejected",
  "Withdrawn",
  "ApplicationOpen",
];

function fullName(p: { firstName: string | null; lastName: string | null }) {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown";
}

export async function getPipelineData(
  userId: string,
  request: Request,
): Promise<PipelineData> {
  const allCycles = await prisma.applicationCycle.findMany({
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const cycles = allCycles.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.statusUpdates[0]?.newStatus ?? "Draft",
  }));

  if (cycles.length === 0) {
    return {
      cycles: [],
      selectedCycleId: "",
      cycleStatus: "",
      accessibleDomains: [],
      selectedDomainId: null,
      selectedStatus: null,
      slices: [],
      rows: [],
      confidentialityRequired: null,
    };
  }

  const url = new URL(request.url);
  const requestedCycleId = url.searchParams.get("cycleId");
  const selectedCycle =
    (requestedCycleId ? cycles.find((c) => c.id === requestedCycleId) : null) ??
    cycles.find((c) => ["Open", "UnderReview"].includes(c.status)) ??
    cycles[0];
  const cycleId = selectedCycle.id;
  const cycleStatus = selectedCycle.status as
    | "Draft"
    | "Open"
    | "UnderReview"
    | "Completed";

  // Domains in this cycle. Both hiring leads and domain leads see all of them.
  const cycleDomains = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: cycleId },
    include: { domain: { select: { id: true, name: true } } },
  });
  const accessibleDomains = cycleDomains.map((d) => ({
    id: d.domain.id,
    name: d.domain.name,
  }));

  // Domain toggle: ?domain=<id> selects one; absent = all accessible
  const domainParam = url.searchParams.get("domain");
  const selectedDomainId =
    domainParam && accessibleDomains.some((d) => d.id === domainParam)
      ? domainParam
      : null;

  const queryDomainIds = selectedDomainId
    ? [selectedDomainId]
    : accessibleDomains.map((d) => d.id);

  // Selected pie slice: ?status=<status>
  const statusParam = url.searchParams.get("status") as AnalyticsStatus | null;
  const selectedStatus =
    statusParam && STATUS_ORDER.includes(statusParam) ? statusParam : null;

  // Confidentiality gate: applicant identities + reviewer/interviewer
  // assignments + per-status counts are all sensitive cycle data, so unsigned
  // viewers see only the cycle/domain selectors and a gate placeholder.
  const confState = await getCycleConfidentialityState(userId, cycleId);
  const confidentialityRequired =
    confState.status === "signed" ? null : confState.status;

  if (confidentialityRequired) {
    return {
      cycles,
      selectedCycleId: cycleId,
      cycleStatus,
      accessibleDomains,
      selectedDomainId,
      selectedStatus: null,
      slices: [],
      rows: [],
      confidentialityRequired,
    };
  }

  // Fetch all selected domain applications with the relations needed for both
  // status inference and the list rendering.
  const domainApplications = await prisma.domainApplication.findMany({
    where: {
      selected: true,
      domainId: { in: queryDomainIds },
      application: { applicationCycleId: cycleId },
    },
    include: {
      ...domainApplicationStatusInclude,
      domain: {
        select: { id: true, name: true },
      },
      application: {
        include: {
          statusUpdates: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
      reviews: {
        select: {
          id: true,
          cycleReviewer: {
            select: {
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      interviews: {
        where: { status: { in: ["Scheduled", "Completed"] } },
        select: {
          id: true,
          assignments: {
            where: { status: "Active" },
            select: {
              cycleInterviewer: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // Build rows + slice counts in one pass.
  const sliceCounts = new Map<AnalyticsStatus, number>();
  const allRows: Array<ApplicationRow & { rawStatus: AnalyticsStatus }> = [];

  for (const da of domainApplications) {
    const baseStatus = inferDomainApplicationStatus(da as any, cycleStatus);
    const hasSubmitted = da.application.statusUpdates.some(
      (u) => u.newStatus === "Submitted",
    );

    // Override: any DA whose application was never submitted is "InProgress"
    // for analytics purposes, regardless of cycle status.
    const status: AnalyticsStatus = !hasSubmitted ? "InProgress" : baseStatus;

    sliceCounts.set(status, (sliceCounts.get(status) ?? 0) + 1);

    const reviewerNames = Array.from(
      new Set(
        (da as any).reviews.map((r: any) => fullName(r.cycleReviewer.user)),
      ),
    ) as string[];

    const interviewerNames = Array.from(
      new Set(
        ((da as any).interviews as any[]).flatMap((iv) =>
          iv.assignments.map((a: any) => fullName(a.cycleInterviewer.user)),
        ),
      ),
    ) as string[];

    allRows.push({
      id: da.id,
      applicantName: fullName(da.application.user),
      status,
      statusLabel: STATUS_LABELS[status],
      domain: da.domain?.name ?? "",
      reviewers: reviewerNames,
      interviewers: interviewerNames,
      rawStatus: status,
    });
  }

  const slices: StatusSlice[] = STATUS_ORDER.map((s) => ({
    status: s,
    label: STATUS_LABELS[s],
    count: sliceCounts.get(s) ?? 0,
  })).filter((s) => s.count > 0);

  const rows: ApplicationRow[] = (selectedStatus
    ? allRows.filter((r) => r.rawStatus === selectedStatus)
    : allRows
  )
    .map(({ rawStatus: _r, ...rest }) => rest)
    .sort((a, b) => a.applicantName.localeCompare(b.applicantName));

  return {
    cycles,
    selectedCycleId: cycleId,
    cycleStatus,
    accessibleDomains,
    selectedDomainId,
    selectedStatus,
    slices,
    rows,
    confidentialityRequired: null,
  };
}
