import { useMemo, useState } from "react";
import { isAdminOnlyCycle } from "~/hiring/lib/applicant-groups";
import { redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import type { Route } from "./+types/applications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { Popover, Select } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import {
  FilterCountBadge,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { StatusPie, type StatusSlice } from "~/hiring/components/analytics/StatusPie";
import { Toggle } from "~/components/ui/Toggle";
import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGE_ORDER,
  pipelineStage,
  type PipelineStage,
} from "~/hiring/lib/pipeline-stage";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";

export const meta: Route.MetaFunction = () => [
  { title: "Applications · Hiring · DALI OS" },
];

// Database view of every application submission for a cycle. One row per
// (applicant, domain) — i.e. per DomainApplication. Access:
//   • Core/Admin (isCore): every domain in every cycle.
//   • Reviewers: only the domains they're a CycleReviewer for, and only the
//     cycles they're assigned on.
// Read-only — rows link to the read-only detail page.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");

  const { isCore, isAdmin, isDomainLead, isInterviewer } = await getUserRoles(auth.user.sub);

  // Reviewer assignments across all cycles — used both to decide which cycles
  // a reviewer can see and to scope domains within the selected cycle.
  const reviewerRows = await prisma.cycleReviewer.findMany({
    where: { userId: auth.user.sub },
    select: { applicationCycleId: true, domainId: true },
  });

  // Hard gate: a user with no hiring role at all (not Core/Admin/DomainLead and
  // a reviewer/interviewer on no cycle) has no business here — send them home
  // rather than showing the "you aren't a reviewer" empty state. (The sidebar
  // already hides Hiring for them; this stops direct navigation too.)
  if (!isCore && !isAdmin && !isDomainLead && reviewerRows.length === 0) {
    const interviewer = await prisma.cycleInterviewer.findFirst({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (!interviewer) return redirect("/");
  }

  // Cycle dropdown: Admins see every cycle. Core (hiring leads) and domain leads
  // see all Students/Interns cycles; Lab members (Core) cycles appear only for
  // Admins and for anyone assigned as a reviewer on them.
  const reviewerCycleIds = new Set(reviewerRows.map((r) => r.applicationCycleId));
  const cyclesRaw = await prisma.applicationCycle.findMany({
    where: isAdmin
      ? {}
      : isCore || isDomainLead
        ? { OR: [{ applicants: { not: "LabMembers" } }, { id: { in: [...reviewerCycleIds] } }] }
        : { id: { in: [...reviewerCycleIds] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      applicants: true,
      // Status is event-sourced; newest update wins, default Draft.
      statusUpdates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { newStatus: true },
      },
    },
  });
  const cycles = cyclesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    applicants: c.applicants,
    currentStatus: c.statusUpdates[0]?.newStatus ?? "Draft",
  }));

  // Neither a Core member with no cycles nor a reviewer with no assignments
  // has anything to show.
  const pillRoles = { isCore, isDomainLead, isAdmin, isInterviewer };

  if (cycles.length === 0) {
    return {
      gate: "empty" as const,
      isCore,
      pillRoles,
    };
  }

  // Selected cycle: ?cycle= if valid, else most recent.
  const url = new URL(request.url);
  const requested = url.searchParams.get("cycle");
  const selected =
    (requested && cycles.find((c) => c.id === requested)) || cycles[0];

  // Domains visible to this user for the selected cycle. Core: all of the
  // cycle's hiring domains. Reviewer: only their assigned domains for THIS
  // cycle.
  const cycleDomainRows = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: selected.id },
    select: { domainId: true },
  });
  const allCycleDomainIds = cycleDomainRows.map((d) => d.domainId);
  const reviewerDomainIdsThisCycle = reviewerRows
    .filter((r) => r.applicationCycleId === selected.id)
    .map((r) => r.domainId);
  // Admins see all domains. Core (hiring leads) see all domains too, except on
  // Lab members cycles — there only assigned reviewers see, so it falls to the
  // reviewer-scoped list.
  const seesAllDomains = isAdmin || (!isAdminOnlyCycle(selected.applicants) && isCore);
  const visibleDomainIds = seesAllDomains
    ? allCycleDomainIds
    : reviewerDomainIdsThisCycle;

  // Domain filter options — the domains this user can see for the selected
  // cycle, with display names. Drives the (client-side) domain dropdown,
  // shown whenever there's more than one domain to choose between.
  const domainOptions = visibleDomainIds.length
    ? (
        await prisma.domain.findMany({
          where: { id: { in: visibleDomainIds } },
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true },
        })
      ).map((d) => ({ id: d.id, name: d.displayName }))
    : [];

  // Core and domain leads get the pipeline pie, so their rows carry the
  // relations stage inference needs.
  const showPipeline = isCore || isDomainLead;

  // DomainApplications for the selected cycle, scoped to visible domains.
  // Standard cycles link Domain via challengeVersion; Fellowship links
  // Domain directly — match whichever path is set (mirrors reviewer route).
  const domainApps = visibleDomainIds.length
    ? await prisma.domainApplication.findMany({
        where: {
          application: { applicationCycleId: selected.id },
          selected: true,
          domainId: { in: visibleDomainIds },
        },
        select: {
          id: true,
          domainId: true,
          domain: { select: { displayName: true } },
          application: {
            select: {
              user: {
                select: { firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
              },
              // Status is event-sourced via ApplicationStatusUpdate; the
              // newest row is the current status. We also grab the most
              // recent "Submitted" event's timestamp for the Submitted column.
              statusUpdates: {
                orderBy: { createdAt: "desc" },
                select: { newStatus: true, createdAt: true },
              },
            },
          },
          _count: { select: { reviews: true } },
          ...(showPipeline && {
            closureReason: true,
            decisions: { orderBy: { createdAt: "desc" as const } },
            interviews: {
              where: {
                status: { in: ["Scheduled", "Completed", "CancelledByApplicant"] as const },
              },
              orderBy: { createdAt: "desc" as const },
            },
          }),
        },
      })
    : [];

  const rows = domainApps
    .map((da) => {
      const u = da.application.user;
      const updates = da.application.statusUpdates;
      const status = updates[0]?.newStatus ?? "Draft";
      const submittedAt =
        updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
      return {
        id: da.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "—",
        email: u.daliEmail ?? u.dartmouthEmail ?? null,
        domainId: da.domainId,
        domain: da.domain?.displayName ?? "—",
        status: status as string,
        submittedAt: submittedAt ? submittedAt.toISOString() : null,
        reviewCount: da._count.reviews,
        stage: showPipeline
          ? pipelineStage(da as any, selected.currentStatus as ApplicationCycleStatus)
          : null,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain),
    );

  return {
    gate: "ok" as const,
    isCore,
    pillRoles,
    cycles: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.currentStatus as string,
    })),
    selectedCycleId: selected.id,
    selectedCycleName: selected.name,
    domainOptions,
    showPipeline,
    rows,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUSES = ["Submitted", "Draft", "Withdrawn"] as const;

const STATUS_TONE: Record<string, string> = {
  Submitted: "bg-os-green/15 text-os-green",
  Draft: "bg-os-container text-os-grey",
  Withdrawn: "bg-os-amber/15 text-os-amber",
};

// Toggle one value in a multi-select filter.
function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ApplicationsDatabase() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { pageTitle, panel } = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();
  // Client-side filters; an empty list means "all". Cleared when the cycle
  // changes (a different cycle has a different domain set).
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  // Unsubmitted drafts swamp the pie early in a cycle, so it leaves them out
  // unless asked. The table is unaffected.
  const [pieIncludesInProgress, setPieIncludesInProgress] = useState(false);
  const [query, setQuery] = useState("");

  const rows = data.gate === "ok" ? data.rows : [];
  // The pie counts every filter but its own, so picking a slice doesn't
  // collapse the chart to that one slice.
  const pieRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (domainIds.length && !domainIds.includes(r.domainId)) return false;
      if (statuses.length && !statuses.includes(r.status)) return false;
      if (q && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, domainIds, statuses, query]);
  const filteredRows = useMemo(
    () => (stage ? pieRows.filter((r) => r.stage === stage) : pieRows),
    [pieRows, stage],
  );
  const slices = useMemo<StatusSlice[]>(() => {
    const counts = new Map<string, number>();
    for (const r of pieRows) if (r.stage) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
    return PIPELINE_STAGE_ORDER.filter((s) => counts.has(s)).map((s: PipelineStage) => ({
      status: s,
      label: PIPELINE_STAGE_LABELS[s],
      count: counts.get(s)!,
    }));
  }, [pieRows]);
  const pieSlices = pieIncludesInProgress
    ? slices
    : slices.filter((s) => s.status !== "InProgress");

  const title = <h1 className={pageTitle}>Applications</h1>;

  if (data.gate === "empty") {
    return (
      <div className="flex flex-col gap-4">
        {title}
        <p className="text-sm text-os-grey">
          {data.isCore
            ? "No application cycles exist yet."
            : "You aren't assigned as a reviewer on any cycle yet."}
        </p>
      </div>
    );
  }

  // Only worth offering the domain filter when there's more than one domain
  // to choose between (Core/Admin, or a reviewer covering multiple domains).
  const showDomainFilter = data.domainOptions.length > 1;
  const activeFilterCount = domainIds.length + statuses.length + (stage ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      {title}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          ariaLabel="Cycle"
          value={data.selectedCycleId}
          onChange={(cycleId) => {
            setDomainIds([]);
            setStatuses([]);
            setStage(null);
            setQuery("");
            const next = new URLSearchParams(searchParams);
            next.set("cycle", cycleId);
            setSearchParams(next);
          }}
          options={data.cycles.map((c) => ({ value: c.id, label: `${c.name} · ${c.status}` }))}
          buttonClassName={cn(filterPillClass(), "w-full sm:w-72")}
        />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search applicants by name or email"
          // Fixed width, not flex-1: a growing search field would slide the
          // Filter pill (and its open panel) whenever the count text changes.
          containerClassName="w-full sm:w-80"
        />
        <Popover
          ariaLabel="Filter applications"
          panelClassName={filterPanelClass(true)}
          trigger={
            <button
              type="button"
              className={customizeButtonClass(true, activeFilterCount > 0)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Filter
              <FilterCountBadge os={true} count={activeFilterCount} />
            </button>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <FilterSectionLabel os={true}>Filters</FilterSectionLabel>
              {activeFilterCount > 0 && (
                <FilterResetButton
                  os={true}
                  onClick={() => {
                    setDomainIds([]);
                    setStatuses([]);
                    setStage(null);
                  }}
                />
              )}
            </div>
            <FilterGroup label="Status" os={true}>
              {STATUSES.map((st) => (
                <FilterPill
                  key={st}
                  os={true}
                  selected={statuses.includes(st)}
                  onClick={() => setStatuses((prev) => toggle(prev, st))}
                >
                  {st}
                </FilterPill>
              ))}
            </FilterGroup>
            {data.showPipeline && slices.length > 0 && (
              <FilterGroup label="Stage" os={true}>
                {slices.map((s) => (
                  <FilterPill
                    key={s.status}
                    os={true}
                    selected={stage === s.status}
                    onClick={() => setStage((prev) => (prev === s.status ? null : s.status))}
                  >
                    {s.label}
                  </FilterPill>
                ))}
              </FilterGroup>
            )}
            {showDomainFilter && (
              <FilterGroup label="Domain" os={true}>
                {data.domainOptions.map((d) => (
                  <FilterPill
                    key={d.id}
                    os={true}
                    selected={domainIds.includes(d.id)}
                    onClick={() => setDomainIds((prev) => toggle(prev, d.id))}
                  >
                    {d.name}
                  </FilterPill>
                ))}
              </FilterGroup>
            )}
          </div>
        </Popover>
        <span className="ml-auto text-base text-os-grey tabular-nums">
          {filteredRows.length}{" "}
          {filteredRows.length === 1 ? "application" : "applications"}
          {filteredRows.length !== rows.length ? ` of ${rows.length}` : ""}
        </span>
      </div>

      {data.showPipeline && rows.length > 0 && (
        <section className={cn(panel, "p-6 flex flex-col gap-2")}>
          <Toggle
            className="self-end"
            label="Include in progress"
            checked={pieIncludesInProgress}
            onChange={(e) => {
              setPieIncludesInProgress(e.target.checked);
              if (!e.target.checked && stage === "InProgress") setStage(null);
            }}
          />
          <StatusPie data={pieSlices} selectedStatus={stage} onSelect={setStage} />
        </section>
      )}

      <div className={cn(panel, "overflow-hidden")}>
        {filteredRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-os-grey">
            {rows.length === 0 ? (
              <>
                No submissions for {data.selectedCycleName}
                {data.isCore ? "" : " in your domains"}.
              </>
            ) : (
              "No applicants match the current filters."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-os-grey text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-4">Applicant</th>
                  <th className="text-left font-medium px-6 py-4">Domain</th>
                  <th className="text-left font-medium px-6 py-4">Status</th>
                  <th className="text-left font-medium px-6 py-4">Submitted</th>
                  <th className="text-left font-medium px-6 py-4">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/hiring/applications/${r.id}`)}
                    className="border-t border-os-container hover:bg-os-card-hover cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3.5 font-medium text-foreground">{r.name}</td>
                    <td className="px-6 py-3.5 text-foreground">{r.domain}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                          STATUS_TONE[r.status] ?? STATUS_TONE.Draft,
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-os-grey">
                      {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                    </td>
                    <td className="px-6 py-3.5 text-os-grey tabular-nums">
                      {r.reviewCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
