import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/analytics";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import type { DomainApplicationStatus } from "~/types";
import { CycleSelector } from "~/components/analytics/CycleSelector";
import { DomainToggle } from "~/components/analytics/DomainToggle";
import { StatusPie } from "~/components/analytics/StatusPie";
import type { StatusSlice } from "~/components/analytics/StatusPie";
import { ApplicationList } from "~/components/analytics/ApplicationList";
import type { ApplicationRow } from "~/components/analytics/ApplicationList";

export const meta: Route.MetaFunction = () => [{ title: "Analytics · DALI OS" }];

// Status used in the analytics view. Adds an "InProgress" bucket on top of
// `DomainApplicationStatus` for domain applications whose owner has never
// submitted (post-process override; schema unchanged).
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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isHiringLead && !roles.isDomainLead) return withAuth(auth, redirect("/"));

  // Cycles for the selector
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
    return withAuth(auth, {
      cycles: [],
      selectedCycleId: "",
      cycleStatus: "",
      accessibleDomains: [],
      selectedDomainId: null,
      selectedStatus: null,
      slices: [],
      rows: [],
    });
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

  // Domains in this cycle
  const cycleDomains = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: cycleId },
    include: { domain: { select: { id: true, name: true } } },
  });
  const allCycleDomains = cycleDomains.map((d) => ({
    id: d.domain.id,
    name: d.domain.name,
  }));

  // Both hiring leads and domain leads see all cycle domains in analytics.
  const accessibleDomains = allCycleDomains;

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

  // ─── Fetch all selected domain applications with the relations needed
  //     for both status inference and the list rendering ────────────────
  const domainApplications = await prisma.domainApplication.findMany({
    where: {
      selected: true,
      challengeVersion: { domainId: { in: queryDomainIds } },
      application: { applicationCycleId: cycleId },
    },
    include: {
      ...domainApplicationStatusInclude,
      challengeVersion: {
        select: { domain: { select: { id: true, name: true } } },
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
              daliMember: { select: { firstName: true, lastName: true } },
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
                  daliMember: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  function fullName(p: { firstName: string | null; lastName: string | null }) {
    return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unknown";
  }

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
        (da as any).reviews.map((r: any) => fullName(r.cycleReviewer.daliMember)),
      ),
    ) as string[];

    const interviewerNames = Array.from(
      new Set(
        ((da as any).interviews as any[]).flatMap((iv) =>
          iv.assignments.map((a: any) => fullName(a.cycleInterviewer.daliMember)),
        ),
      ),
    ) as string[];

    allRows.push({
      id: da.id,
      applicantName: fullName(da.application.user),
      status,
      statusLabel: STATUS_LABELS[status],
      domain: (da as any).challengeVersion.domain.name,
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

  return withAuth(auth, {
    cycles,
    selectedCycleId: cycleId,
    cycleStatus,
    accessibleDomains,
    selectedDomainId,
    selectedStatus,
    slices,
    rows,
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

  const selectedDomainName =
    data.accessibleDomains.find((d: any) => d.id === data.selectedDomainId)?.name ??
    null;
  const selectedSlice = data.slices.find(
    (s: StatusSlice) => s.status === data.selectedStatus,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <div className="flex items-center gap-2">
          {data.accessibleDomains.length > 1 && (
            <DomainToggle
              domains={data.accessibleDomains}
              selectedDomainId={data.selectedDomainId}
            />
          )}
          <CycleSelector cycles={data.cycles} selectedCycleId={data.selectedCycleId} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Applications by Status
          </h3>
          <span className="text-xs text-muted-foreground">
            Click a slice to filter the list below
          </span>
        </div>
        <StatusPie data={data.slices} selectedStatus={data.selectedStatus} />
      </div>

      <ApplicationList
        rows={data.rows}
        selectedStatusLabel={selectedSlice?.label ?? null}
        selectedDomainName={selectedDomainName}
      />
    </div>
  );
}
