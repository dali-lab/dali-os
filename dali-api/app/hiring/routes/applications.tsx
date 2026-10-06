import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "~/hooks/usePersistedState";
import {
  EMPTY_FILTERS,
  ENGAGEMENT_FILTERS,
  isApplicationFilters,
  type ApplicationFilters,
} from "~/hiring/lib/application-filters";
import { isAdminOnlyCycle } from "~/hiring/lib/applicant-groups";
import { redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import type { Route } from "./+types/applications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
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
import { applicationBlindLabelsForCycle, blindUser } from "~/hiring/lib/anonymization.server";

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

  const roles = await getUserRoles(auth.user.sub);
  const { isCore, isAdmin, isDomainLead, isInterviewer } = roles;

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
      anonymizeReview: true,
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
    anonymizeReview: c.anonymizeReview,
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
              id: true,
              user: {
                select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
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

  // Blind review applies here the same way it does on the applicant-detail
  // pages: everyone (Core, Admin, leads, reviewers) sees "Applicant N" until
  // every domain the applicant selected has a Released decision. A domain
  // outside this viewer's visible set still counts, so the full set of each
  // application's selected DomainApplications is looked up separately from
  // the (possibly domain-filtered) `domainApps` rows above.
  const applicationIds = [...new Set(domainApps.map((da) => da.application.id))];
  const daIdsByApplication = new Map<string, string[]>();
  if (applicationIds.length > 0) {
    const allSelectedDas = await prisma.domainApplication.findMany({
      where: { applicationId: { in: applicationIds }, selected: true },
      select: { id: true, applicationId: true },
    });
    for (const row of allSelectedDas) {
      const arr = daIdsByApplication.get(row.applicationId) ?? [];
      arr.push(row.id);
      daIdsByApplication.set(row.applicationId, arr);
    }
  }
  const blindLabels = await applicationBlindLabelsForCycle({
    cycleId: selected.id,
    anonymizeReview: selected.anonymizeReview,
    applications: [...daIdsByApplication.entries()].map(([id, daIds]) => ({ id, daIds })),
  });

  // Engagement signals for the filter panel: one grouped lookup each, keyed
  // on the applicant's User id, which blinding leaves intact.
  const applicantUserIds = [...new Set(domainApps.map((da) => da.application.user.id))];
  const emailFilterEnabled = await isFeatureEnabled(
    "applicant-email-engagement",
    auth.user.sub,
    roles,
    request,
  );
  const [priorRows, emailRows, educationRows] = applicantUserIds.length
    ? await Promise.all([
        prisma.application.findMany({
          where: {
            userId: { in: applicantUserIds },
            applicationCycleId: { not: selected.id },
            statusUpdates: { some: { newStatus: "Submitted" } },
          },
          select: { userId: true },
          distinct: ["userId"],
        }),
        emailFilterEnabled
          ? prisma.mailMessageIndex.findMany({
              where: { linkedUserId: { in: applicantUserIds } },
              select: { linkedUserId: true },
              distinct: ["linkedUserId"],
            })
          : Promise.resolve([]),
        prisma.educationApplication.findMany({
          where: { applicantUserId: { in: applicantUserIds }, status: "Approved" },
          select: { applicantUserId: true },
          distinct: ["applicantUserId"],
        }),
      ])
    : [[], [], []];
  const returningUserIds = new Set(priorRows.map((r) => r.userId));
  const emailedUserIds = new Set(emailRows.map((r) => r.linkedUserId));
  const educatedUserIds = new Set(educationRows.map((r) => r.applicantUserId));

  const rows = domainApps
    .map((da) => {
      const blindLabel = blindLabels.get(da.application.id);
      const u = blindLabel ? blindUser(da.application.user, blindLabel) : da.application.user;
      const updates = da.application.statusUpdates;
      const status = updates[0]?.newStatus ?? "Draft";
      const submittedAt =
        updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
      return {
        id: da.id,
        applicationId: da.application.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "—",
        email: u.daliEmail ?? u.dartmouthEmail ?? null,
        domainId: da.domainId,
        domain: da.domain?.displayName ?? "—",
        status: status as string,
        submittedAt: submittedAt ? submittedAt.toISOString() : null,
        reviewCount: da._count.reviews,
        returning: returningUserIds.has(da.application.user.id),
        emailed: emailedUserIds.has(da.application.user.id),
        educated: educatedUserIds.has(da.application.user.id),
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
    emailFilterEnabled,
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
function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ApplicationsDatabase() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { pageTitle, panel } = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCycleId = data.gate === "ok" ? data.selectedCycleId : null;
  // Filters are remembered per cycle so opening an applicant and coming back
  // (or returning days later) lands on the same view. An empty list means
  // "all"; a cycle with nothing stored starts clean.
  const [filters, setFilters] = usePersistedState<ApplicationFilters>(
    `dali:applications:filters:${selectedCycleId ?? "none"}`,
    EMPTY_FILTERS,
    isApplicationFilters,
  );
  const { domainIds, statuses, stage, engagement, pieIncludesInProgress, query } = filters;
  const patch = (next: Partial<ApplicationFilters>) => setFilters((prev) => ({ ...prev, ...next }));
  const setDomainIds = (f: (prev: string[]) => string[]) => patch({ domainIds: f(domainIds) });
  const setStatuses = (f: (prev: string[]) => string[]) => patch({ statuses: f(statuses) });
  const setStage = (next: string | null | ((prev: string | null) => string | null)) =>
    patch({ stage: typeof next === "function" ? next(stage) : next });
  const setQuery = (next: string) => patch({ query: next });

  // The last cycle viewed is remembered too: landing on the page without
  // ?cycle= reopens it instead of the newest cycle.
  const [lastCycleId, setLastCycleId] = usePersistedState<string | null>(
    "dali:applications:cycle",
    null,
    (v): v is string | null => v === null || typeof v === "string",
  );
  const cycleIds = data.gate === "ok" ? data.cycles.map((c) => c.id) : [];
  useEffect(() => {
    if (!selectedCycleId) return;
    if (searchParams.get("cycle")) {
      if (lastCycleId !== selectedCycleId) setLastCycleId(selectedCycleId);
      return;
    }
    if (lastCycleId && lastCycleId !== selectedCycleId && cycleIds.includes(lastCycleId)) {
      const next = new URLSearchParams(searchParams);
      next.set("cycle", lastCycleId);
      setSearchParams(next, { replace: true });
    }
    // Runs when the cycle or the stored preference changes, not on every param edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleId, lastCycleId]);

  const rows = data.gate === "ok" ? data.rows : [];
  // A remembered domain that this viewer can no longer see (reassigned, or a
  // domain dropped from the cycle) must not silently empty the table.
  const knownDomainIds = new Set(data.gate === "ok" ? data.domainOptions.map((d) => d.id) : []);
  const activeDomainIds = domainIds.filter((id) => knownDomainIds.has(id));
  // The pie counts every filter but its own, so picking a slice doesn't
  // collapse the chart to that one slice.
  const pieRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeDomainIds.length && !activeDomainIds.includes(r.domainId)) return false;
      if (statuses.length && !statuses.includes(r.status)) return false;
      if (engagement.some((k) => !r[k])) return false;
      if (q && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, activeDomainIds, statuses, engagement, query]);
  const filteredRows = useMemo(
    () => (stage ? pieRows.filter((r) => r.stage === stage) : pieRows),
    [pieRows, stage],
  );
  // One applicant can hold several domain applications, so the row count
  // overstates how many people are in the cycle.
  const totalApplicants = useMemo(() => new Set(rows.map((r) => r.applicationId)).size, [rows]);
  const filteredApplicants = useMemo(
    () => new Set(filteredRows.map((r) => r.applicationId)).size,
    [filteredRows],
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
  const activeFilterCount =
    activeDomainIds.length + statuses.length + engagement.length + (stage ? 1 : 0);
  const engagementOptions = ENGAGEMENT_FILTERS.filter(
    (e) => e.key !== "emailed" || data.emailFilterEnabled,
  );

  return (
    <div className="flex flex-col gap-4">
      {title}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          ariaLabel="Cycle"
          value={data.selectedCycleId}
          onChange={(cycleId) => {
            setLastCycleId(cycleId);
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
                  onClick={() => patch({ domainIds: [], statuses: [], stage: null, engagement: [] })}
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
            <FilterGroup label="Engagement" os={true}>
              {engagementOptions.map((e) => (
                <FilterPill
                  key={e.key}
                  os={true}
                  selected={engagement.includes(e.key)}
                  onClick={() => patch({ engagement: toggle(engagement, e.key) })}
                >
                  {e.label}
                </FilterPill>
              ))}
            </FilterGroup>
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
          {" · "}
          {filteredApplicants}{" "}
          {filteredApplicants === 1 ? "applicant" : "applicants"}
          {filteredApplicants !== totalApplicants ? ` of ${totalApplicants}` : ""}
        </span>
      </div>

      {data.showPipeline && rows.length > 0 && (
        <section className={cn(panel, "p-6 flex flex-col gap-2")}>
          <Toggle
            className="self-end"
            label="Include in progress"
            checked={pieIncludesInProgress}
            onChange={(e) =>
              patch({
                pieIncludesInProgress: e.target.checked,
                stage: !e.target.checked && stage === "InProgress" ? null : stage,
              })
            }
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
