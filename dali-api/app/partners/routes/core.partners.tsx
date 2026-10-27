import { useMemo, useState } from "react";
import { redirect, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Popover } from "~/components/ui/floating";
import type { Route } from "./+types/core.partners";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isCore, currentTerm } from "~/lib/roles";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PartnerBoard } from "../components/PartnerBoard";
import { PartnerPlanTable } from "../components/PartnerPlanTable";
import { PartnerApplicationModal } from "../components/PartnerApplicationModal";
import {
  DEFAULT_FILTERS,
  SOURCE_OPTIONS,
  filterPartnerCards,
  isPartnerFilters,
  type PartnerFilters,
} from "../lib/partner-board";
import {
  PARTNER_PLANNING_STATUSES,
  groupPlannerRows,
  type PartnerListCard,
  type PartnerPlanningStatus,
  type PlanningStatusFilter,
} from "../lib/partner-planning";
import { SearchInput } from "~/components/ui/SearchInput";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { usePersistedState } from "~/hooks/usePersistedState";
import {
  FilterCountBadge,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  FilterToggleRow,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
import { Plus, Settings, SlidersHorizontal } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { PartnerSettingsModal } from "../components/PartnerSettingsModal";

// areaSubnav: this page mounts PartnerCrmNav itself at the top, so the shell
// must not add its own sub-nav row above it.
export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [
  { title: "Partners · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [applications, crmSettings, allDomains, allTerms, currentTermRow] = await Promise.all([
    prisma.partnerApplication.findMany({
      orderBy: [{ stage: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        stage: true,
        position: true,
        resultingProjectId: true,
        source: true,
        feeCents: true,
        nextStep: true,
        nextStepDueAt: true,
        lastActivityAt: true,
        holdUntil: true,
        meetingRequestedAt: true,
        createdAt: true,
        partnerOrg: { select: { name: true } },
        applicantContact: { select: { name: true } },
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          select: {
            id: true,
            planningStatus: true,
            plannerNotes: true,
            plannerTodo: true,
            term: { select: { id: true, code: true, sortKey: true } },
          },
        },
        domains: {
          select: {
            id: true,
            domainId: true,
            expectedMembers: true,
            domain: { select: { displayName: true } },
          },
        },
        meetings: { select: { id: true } },
        meetingRequests: { where: { status: "Pending" }, select: { id: true } },
      },
    }),
    prisma.partnerCrmSettings.findUnique({ where: { id: "default" } }),
    prisma.domain.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    currentTerm(request),
  ]);

  const cards: PartnerListCard[] = applications.map((a) => ({
    id: a.id,
    title: a.title,
    stage: a.stage,
    status: a.stage,
    position: a.position,
    contactName: a.applicantContact?.name ?? "Unknown",
    orgName: a.partnerOrg?.name ?? null,
    partnerName: a.partnerOrg?.name ?? a.applicantContact?.name ?? "Unknown",
    domains: a.domains.map((d) => ({ id: d.domainId, name: d.domain.displayName })),
    targetTerms: a.targetTerms.map((t) => ({ id: t.term.id, code: t.term.code })),
    nextStep: a.nextStep,
    nextStepDueAt: a.nextStepDueAt?.toISOString() ?? null,
    lastActivityAt: a.lastActivityAt.toISOString(),
    holdUntil: a.holdUntil?.toISOString() ?? null,
    resultingProjectId: a.resultingProjectId,
    meetingRequestedAt: a.meetingRequestedAt?.toISOString() ?? null,
    pendingRequestCount: a.meetingRequests.length,
    meetingCount: a.meetings.length,
    source: a.source,
    // No cheap per-card unread signal yet: the Email tab reads per-contact
    // threads on open instead. Revisit once MailMessageIndex is linked here.
    hasUnreadEmail: false,
    createdAt: a.createdAt.toISOString(),
    feeCents: a.feeCents,
    plan: a.targetTerms.map((t) => ({
      targetTermId: t.id,
      termId: t.term.id,
      code: t.term.code,
      sortKey: t.term.sortKey,
      planningStatus: t.planningStatus as PartnerPlanningStatus | null,
      plannerNotes: t.plannerNotes,
      plannerTodo: t.plannerTodo,
    })),
    headcount: a.domains.map((d) => ({
      id: d.id,
      domainId: d.domainId,
      expectedMembers: d.expectedMembers,
    })),
  }));

  return {
    cards,
    staleDays: crmSettings?.staleDays ?? 14,
    hiddenDomainIds: crmSettings?.plannerHiddenDomainIds ?? [],
    domainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    termOptions: allTerms,
    currentTermStartIso: currentTermRow?.startDate.toISOString() ?? null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to change the list columns." };
  }

  const form = await request.formData();
  if (form.get("intent") !== "set-hidden-domains") {
    return { error: "Unknown action." };
  }
  const plannerHiddenDomainIds = [
    ...new Set(form.getAll("hiddenDomainIds").map(String).filter(Boolean)),
  ];
  await prisma.partnerCrmSettings.upsert({
    where: { id: "default" },
    create: { id: "default", plannerHiddenDomainIds },
    update: { plannerHiddenDomainIds },
  });
  await logAuditEvent({
    action: "partner.settings.save",
    userId: auth.user.sub,
    targetId: "default",
    metadata: { plannerHiddenDomainIds },
    request,
  });
  return { ok: true };
}

const PLAN_FILTERS: PlanningStatusFilter[] = [...PARTNER_PLANNING_STATUSES, "Unset"];

export default function PartnersApplications() {
  const {
    cards,
    staleDays,
    hiddenDomainIds,
    domainOptions,
    termOptions,
    currentTermStartIso,
  } = useLoaderData<typeof loader>();
  const planning = useFeatureFlag("partner-planning");
  const revalidator = useRevalidator();
  const [view, setView] = useViewPreference("partners:pipeline-view", "card");
  const [creating, setCreating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const settingsOpen = searchParams.get("settings") === "1";
  const openId = searchParams.get("application");
  const openCard = openId ? cards.find((c) => c.id === openId) ?? null : null;

  const [query, setQuery] = useState("");
  const [filters, setFilters] = usePersistedState<PartnerFilters>(
    "dali:partnerboard:filters",
    DEFAULT_FILTERS,
    isPartnerFilters,
  );
  const [planFilter, setPlanFilter] = useState<PlanningStatusFilter | null>(null);
  const listPlanFilter = view === "list" && planning ? planFilter : null;

  const filterCount =
    (filters.term ? 1 : 0) +
    (filters.domain ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.staleOnly ? 1 : 0) +
    (filters.showPaused ? 0 : 1) +
    (filters.showRejectedPastTerms ? 1 : 0) +
    (listPlanFilter ? 1 : 0);
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setPlanFilter(null);
  };

  const columnsFetcher = useFetcher();
  const pendingHidden = columnsFetcher.formData?.getAll("hiddenDomainIds").map(String);
  const hidden = new Set(pendingHidden ?? hiddenDomainIds);
  const visibleDomains = domainOptions.filter((d) => !hidden.has(d.id));
  const toggleColumn = (domainId: string) => {
    const next = new Set(hidden);
    if (next.has(domainId)) next.delete(domainId);
    else next.add(domainId);
    const form = new FormData();
    form.set("intent", "set-hidden-domains");
    for (const id of next) form.append("hiddenDomainIds", id);
    columnsFetcher.submit(form, { method: "post" });
  };

  const filtered = useMemo(
    () => filterPartnerCards(cards, filters, query, { staleDays, currentTermStartIso }),
    [cards, filters, query, staleDays, currentTermStartIso],
  );
  const groups = useMemo(
    () => (view === "list" ? groupPlannerRows(filtered, filters.term, listPlanFilter) : []),
    [view, filtered, filters.term, listPlanFilter],
  );

  return (
    <div className="flex flex-col gap-4">
      <PartnerCrmNav />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applications…"
          aria-label="Search applications"
          containerClassName="w-full max-w-[420px] sm:w-72"
        />
        <Popover
          align="left"
          ariaLabel="Customize applications"
          panelClassName={filterPanelClass(true)}
          trigger={
            <button type="button" className={customizeButtonClass(true, filterCount > 0)}>
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Customize
              <FilterCountBadge os={true} count={filterCount} />
            </button>
          }
        >
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <FilterSectionLabel os={true}>Filters</FilterSectionLabel>
                {filterCount > 0 && <FilterResetButton os={true} onClick={resetFilters} />}
              </div>

              {termOptions.length > 0 && (
                <FilterGroup label="Term" os={true}>
                  <FilterPill
                    os={true}
                    selected={!filters.term}
                    onClick={() => setFilters((f) => ({ ...f, term: null }))}
                  >
                    All
                  </FilterPill>
                  {termOptions.map((t) => (
                    <FilterPill
                      key={t.id}
                      os={true}
                      selected={filters.term === t.id}
                      onClick={() => setFilters((f) => ({ ...f, term: t.id }))}
                    >
                      {t.code}
                    </FilterPill>
                  ))}
                </FilterGroup>
              )}

              {domainOptions.length > 0 && (
                <FilterGroup label="Domain" os={true}>
                  <FilterPill
                    os={true}
                    selected={!filters.domain}
                    onClick={() => setFilters((f) => ({ ...f, domain: null }))}
                  >
                    All
                  </FilterPill>
                  {domainOptions.map((d) => (
                    <FilterPill
                      key={d.id}
                      os={true}
                      selected={filters.domain === d.id}
                      onClick={() => setFilters((f) => ({ ...f, domain: d.id }))}
                    >
                      {d.name}
                    </FilterPill>
                  ))}
                </FilterGroup>
              )}

              <FilterGroup label="Source" os={true}>
                <FilterPill
                  os={true}
                  selected={!filters.source}
                  onClick={() => setFilters((f) => ({ ...f, source: null }))}
                >
                  All
                </FilterPill>
                {SOURCE_OPTIONS.map((s) => (
                  <FilterPill
                    key={s.value}
                    os={true}
                    selected={filters.source === s.value}
                    onClick={() => setFilters((f) => ({ ...f, source: s.value }))}
                  >
                    {s.label}
                  </FilterPill>
                ))}
              </FilterGroup>
            </section>

            <section className="flex flex-col gap-3 border-t border-os-container pt-3">
              <FilterSectionLabel os={true}>Visibility</FilterSectionLabel>
              <FilterToggleRow
                label="Stale only"
                os={true}
                checked={filters.staleOnly}
                onChange={(checked) => setFilters((f) => ({ ...f, staleOnly: checked }))}
              />
              <FilterToggleRow
                label="Show paused"
                os={true}
                checked={filters.showPaused}
                onChange={(checked) => setFilters((f) => ({ ...f, showPaused: checked }))}
              />
              <FilterToggleRow
                label="Show rejected from past terms"
                os={true}
                checked={filters.showRejectedPastTerms}
                onChange={(checked) =>
                  setFilters((f) => ({ ...f, showRejectedPastTerms: checked }))
                }
              />
            </section>

            {view === "list" && (
              <section className="flex flex-col gap-3 border-t border-os-container pt-3">
                <FilterSectionLabel os={true}>List</FilterSectionLabel>
                {planning && (
                  <FilterGroup label="Plan status" os={true}>
                    <FilterPill os={true} selected={!planFilter} onClick={() => setPlanFilter(null)}>
                      All
                    </FilterPill>
                    {PLAN_FILTERS.map((s) => (
                      <FilterPill
                        key={s}
                        os={true}
                        selected={planFilter === s}
                        onClick={() => setPlanFilter(s)}
                      >
                        {s === "Unset" ? "No status" : s}
                      </FilterPill>
                    ))}
                  </FilterGroup>
                )}
                <FilterGroup label="Headcount columns" os={true}>
                  {domainOptions.map((d) => (
                    <FilterPill
                      key={d.id}
                      os={true}
                      selected={!hidden.has(d.id)}
                      onClick={() => toggleColumn(d.id)}
                    >
                      {d.name}
                    </FilterPill>
                  ))}
                </FilterGroup>
              </section>
            )}
          </div>
        </Popover>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {cards.length}
        </span>
        <IconButton
          label="Partner settings"
          icon={Settings}
          onClick={() => setParam("settings", "1")}
          className="os-icon-btn ml-auto"
        />
        <ViewToggle value={view} onChange={setView} />
        <button type="button" onClick={() => setCreating(true)} className="os-add-btn">
          <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
          New application
        </button>
      </div>

      {settingsOpen && <PartnerSettingsModal onClose={() => setParam("settings", null)} />}

      {view === "list" ? (
        <PartnerPlanTable
          groups={groups}
          domains={visibleDomains}
          planning={planning}
          staleDays={staleDays}
          onOpen={(id) => setParam("application", id)}
        />
      ) : (
        <PartnerBoard
          cards={cards}
          canEdit
          staleDays={staleDays}
          currentTermStartIso={currentTermStartIso}
          query={query}
          filters={filters}
          onOpen={(id) => setParam("application", id)}
        />
      )}

      {(openCard || creating) && (
        <PartnerApplicationModal
          card={openCard}
          canEdit
          domainOptions={domainOptions}
          termOptions={termOptions}
          onClose={() => {
            setParam("application", null);
            setCreating(false);
          }}
          onChanged={() => {
            if (revalidator.state === "idle") void revalidator.revalidate();
          }}
        />
      )}
    </div>
  );
}
