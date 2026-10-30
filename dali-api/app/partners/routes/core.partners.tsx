import { useEffect, useState } from "react";
import { redirect, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Popover } from "~/components/ui/floating";
import type { Route } from "./+types/core.partners";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore, currentTerm } from "~/lib/roles";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PartnerBoard } from "../components/PartnerBoard";
import { PartnerApplicationModal } from "../components/PartnerApplicationModal";
import {
  CARD_SORTS,
  CARD_SORT_LABELS,
  DEFAULT_FILTERS,
  filtersFromParams,
  isCardSort,
  isPartnerFilters,
  SOURCE_OPTIONS,
  type PartnerCardModel,
  type PartnerCardSort,
  type PartnerFilters,
} from "../lib/partner-board";
import { SearchInput } from "~/components/ui/SearchInput";
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
      where: { source: { not: "Renewal" } },
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
            term: { select: { id: true, code: true } },
          },
        },
        domains: {
          select: {
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

  const projectIds = applications.flatMap((a) => (a.resultingProjectId ? [a.resultingProjectId] : []));
  const projectIcons = new Map(
    (projectIds.length
      ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, iconEmoji: true } })
      : []
    ).map((p) => [p.id, p.iconEmoji]),
  );

  const cards: PartnerCardModel[] = applications.map((a) => ({
    id: a.id,
    title: a.title,
    stage: a.stage,
    status: a.stage,
    position: a.position,
    contactName: a.applicantContact?.name ?? "Unknown",
    orgName: a.partnerOrg?.name ?? null,
    domains: a.domains.map((d) => ({
      id: d.domainId,
      name: d.domain.displayName,
      expectedMembers: d.expectedMembers,
    })),
    targetTerms: a.targetTerms.map((t) => ({ id: t.term.id, code: t.term.code })),
    nextStep: a.nextStep,
    nextStepDueAt: a.nextStepDueAt?.toISOString() ?? null,
    feeCents: a.feeCents,
    lastActivityAt: a.lastActivityAt.toISOString(),
    holdUntil: a.holdUntil?.toISOString() ?? null,
    resultingProjectId: a.resultingProjectId,
    projectIconEmoji: a.resultingProjectId ? (projectIcons.get(a.resultingProjectId) ?? null) : null,
    meetingRequestedAt: a.meetingRequestedAt?.toISOString() ?? null,
    pendingRequestCount: a.meetingRequests.length,
    meetingCount: a.meetings.length,
    source: a.source,
    // No cheap per-card unread signal yet: the Email tab reads per-contact
    // threads on open instead. Revisit once MailMessageIndex is linked here.
    hasUnreadEmail: false,
    createdAt: a.createdAt.toISOString(),
  }));

  return {
    cards,
    staleDays: crmSettings?.staleDays ?? 14,
    domainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    termOptions: allTerms,
    currentTermStartIso: currentTermRow?.startDate.toISOString() ?? null,
  };
}

export default function PartnersApplications() {
  const {
    cards,
    staleDays,
    domainOptions,
    termOptions,
    currentTermStartIso,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
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
  const [sort, setSort] = usePersistedState<PartnerCardSort>(
    "dali:partnerboard:sort",
    "manual",
    isCardSort,
  );

  useEffect(() => {
    if (!searchParams.has("source") && !searchParams.has("term")) return;
    setFilters((f) =>
      filtersFromParams(f, searchParams, {
        sources: SOURCE_OPTIONS.map((s) => s.value),
        termIds: termOptions.map((t) => t.id),
      }),
    );
    // Only the initial URL seeds the filters; later edits go through Customize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterCount =
    (filters.term ? 1 : 0) +
    (filters.domain ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.staleOnly ? 1 : 0) +
    (filters.showPaused ? 0 : 1) +
    (filters.showRejectedPastTerms ? 1 : 0) +
    (sort !== "manual" ? 1 : 0);
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSort("manual");
  };


  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <PartnerCrmNav className="shrink-0 self-start md:self-center" />
        <div className="flex-1" />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applications…"
          aria-label="Search applications"
          containerClassName="w-full sm:w-36 sm:shrink-0"
        />
        <Popover
          align="right"
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
              <FilterSectionLabel os={true}>Sort cards</FilterSectionLabel>
              <FilterGroup label="Order within each column" os={true}>
                {CARD_SORTS.map((value) => (
                  <FilterPill
                    key={value}
                    os={true}
                    selected={sort === value}
                    onClick={() => setSort(value)}
                  >
                    {CARD_SORT_LABELS[value]}
                  </FilterPill>
                ))}
              </FilterGroup>
            </section>

            <section className="flex flex-col gap-3 border-t border-os-container pt-3">
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

          </div>
        </Popover>
        <IconButton
          label="Partner settings"
          icon={Settings}
          onClick={() => setParam("settings", "1")}
          className="os-icon-btn"
        />
        <button type="button" onClick={() => setCreating(true)} className="os-add-btn shrink-0 whitespace-nowrap">
          <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
          New application
        </button>
      </div>

      {settingsOpen && <PartnerSettingsModal onClose={() => setParam("settings", null)} />}

      <PartnerBoard
          cards={cards}
          canEdit
          staleDays={staleDays}
          currentTermStartIso={currentTermStartIso}
          query={query}
          filters={filters}
          sort={sort}
          onOpen={(id) => setParam("application", id)}
      />

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
