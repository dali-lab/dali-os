import { useMemo, useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { Popover } from "~/components/ui/floating";
import { resolveTermFilter } from "~/lib/terms";
import { UPCOMING, termFilterOrder } from "~/lib/terms.shared";
import type { Route } from "./+types/core.partners";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { isCore, currentTerm } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import {
  PartnerBoard,
  DEFAULT_FILTERS,
  SOURCE_OPTIONS,
  isPartnerFilters,
  type PartnerFilters,
} from "../components/PartnerBoard";
import type { PartnerCardModel } from "../lib/partner-board";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  PARTNER_STAGES as STAGES,
  PARTNER_STAGE_LABELS as STAGE_LABEL,
  PARTNER_STAGE_PILL,
  type PartnerStage as Status,
} from "../lib/partner-application";
import { pitchExcerpt } from "../lib/application-form.server";
import type { Question } from "~/types";
import { createPartnerApplication } from "../lib/partner-application-create.server";
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
import { Plus, SlidersHorizontal } from "lucide-react";

// areaSubnav: this page mounts PartnerCrmNav (Board/Directory) itself at the
// top, so the shell must not add its own sub-nav row above it.
export const handle = { ...coreHandle("partners"), areaSubnav: true };

export const meta: Route.MetaFunction = () => [
  { title: "Partner CRM · DALI OS" },
];


type DomainScopeOut = {
  domainId: string;
  domainName: string;
  expectedMembers: number;
};

type ApplicationRow = {
  id: string;
  title: string;
  stage: Status;
  resultingProjectId: string | null;
  partnerName: string;
  partnerLogoUrl: string | null;
  // The partner's pitch prose: first textarea answer from their form
  // submission, falling back to the (Core-written) internal summary.
  excerpt: string | null;
  targetTerms: { id: string; code: string; sortKey: number }[];
  domains: DomainScopeOut[];
  totalExpectedMembers: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [applications, canEdit, termFilter, crmSettings, allDomains, allTerms, currentTermRow] =
    await Promise.all([
    prisma.partnerApplication.findMany({
      orderBy: [{ stage: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        summary: true,
        stage: true,
        position: true,
        resultingProjectId: true,
        source: true,
        nextStep: true,
        nextStepDueAt: true,
        lastActivityAt: true,
        holdUntil: true,
        meetingRequestedAt: true,
        createdAt: true,
        partnerOrg: { select: { name: true, logoUrl: true } },
        applicantContact: { select: { id: true, name: true, email: true } },
        formSubmission: {
          select: {
            answers: true,
            formVersion: { select: { questions: true } },
          },
        },
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          select: { term: { select: { id: true, code: true, sortKey: true } } },
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
    isCore(auth.user.sub),
    // Partner projects are planned several terms out, so default to the current
    // term plus every upcoming one; history stays under "All terms".
    resolveTermFilter(request, { default: "upcoming" }),
    prisma.partnerCrmSettings.findUnique({ where: { id: "default" } }),
    prisma.domain.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    currentTerm(request),
  ]);

  const rows: ApplicationRow[] = await Promise.all(applications.map(async (a) => {
    const domains = a.domains.map((d) => ({
      domainId: d.domainId,
      domainName: d.domain.displayName,
      expectedMembers: d.expectedMembers,
    }));
    const answerExcerpt = a.formSubmission
      ? pitchExcerpt(
          (a.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
          (a.formSubmission.answers as Record<string, unknown>) ?? {},
        )
      : null;
    return {
      id: a.id,
      title: a.title,
      stage: a.stage,
      resultingProjectId: a.resultingProjectId,
      partnerName: a.partnerOrg?.name ?? a.applicantContact?.name ?? "Unknown",
      excerpt: answerExcerpt ?? a.summary,
      // Uploaded logos are stored as S3 keys; presign for display.
      partnerLogoUrl: await resolvePhotoUrl(a.partnerOrg?.logoUrl ?? null),
      targetTerms: a.targetTerms.map((t) => ({
        id: t.term.id,
        code: t.term.code,
        sortKey: t.term.sortKey,
      })),
      domains,
      totalExpectedMembers: domains.reduce((s, d) => s + d.expectedMembers, 0),
    };
  }));

  // The board's card model (specs/partner-crm.md §4) — PartnerBoard.tsx is
  // modeled on TaskBoard.tsx, which reads TaskCardModel[] the same way.
  const cards: PartnerCardModel[] = applications.map((a) => ({
    id: a.id,
    title: a.title,
    stage: a.stage,
    status: a.stage,
    position: a.position,
    contactName: a.applicantContact?.name ?? "Unknown",
    orgName: a.partnerOrg?.name ?? null,
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
    // No cheap per-card unread signal yet — the Email tab reads per-contact
    // threads on open instead. Revisit once MailMessageIndex is linked here.
    hasUnreadEmail: false,
    createdAt: a.createdAt.toISOString(),
  }));

  return {
    rows,
    cards,
    canEdit,
    terms: termFilter.terms,
    selected: termFilter.selected,
    termIds: termFilter.termIds,
    isAll: termFilter.isAll,
    staleDays: crmSettings?.staleDays ?? 14,
    domainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    termOptions: allTerms,
    currentTermStartIso: currentTermRow?.startDate.toISOString() ?? null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create applications." };
  }

  const form = await request.formData();

  const title = (form.get("title") as string | null)?.trim() ?? "";
  const applicantName = (form.get("applicantName") as string | null)?.trim() ?? "";
  const applicantEmail = (form.get("applicantEmail") as string | null)?.trim().toLowerCase() ?? "";
  const summary = (form.get("summary") as string | null)?.trim() ?? "";
  const source = (form.get("source") as string | null) ?? "Manual";
  const targetTermIds = [...new Set(form.getAll("targetTermId").map((v) => String(v).trim()).filter(Boolean))];
  const domainIds = [...new Set(form.getAll("domainId").map((v) => String(v).trim()).filter(Boolean))];

  // This form-based intent is the list view's inline "New application" form;
  // the board modal's create mode posts JSON to POST /api/partner-applications
  // instead (api.partner-applications.ts) so it can stay on the board. Both
  // share createPartnerApplication() for validation and side effects.
  const result = await createPartnerApplication({
    title,
    applicantName,
    applicantEmail,
    summary,
    source,
    targetTermIds,
    domainIds,
    actorUserId: auth.user.sub,
  });
  if ("error" in result) return { error: result.error };
  return redirect(`/core/partners/applications/${result.id}`);
}

export default function PartnersApplications() {
  const {
    rows,
    cards,
    canEdit,
    terms,
    selected,
    termIds,
    isAll,
    staleDays,
    domainOptions: boardDomainOptions,
    termOptions: boardTermOptions,
    currentTermStartIso,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<Status | "all">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  // Term filter for planning — projects/applications are planned several terms
  // out and can target multiple terms, so a row matches if ANY target term is
  // in the selected scope. Applies to the list view. Persisted in the URL
  // (?term=) by the Customize panel so a shared/reloaded link keeps the scope;
  // the loader defaults it to "Current & upcoming" (isAll/termIds come
  // thence).
  // Board is the default landing per specs/partner-crm.md §4 — ViewToggle's
  // "card" is this page's board.
  const [view, setView] = useViewPreference("partners:pipeline-view", "card");
  const [creating, setCreating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // The board's own search + filters (specs/partner-crm.md §18: one nav row
  // above the board, with Customize as the only other control on the page).
  const [boardQuery, setBoardQuery] = useState("");
  const [boardFilters, setBoardFilters] = usePersistedState<PartnerFilters>(
    "dali:partnerboard:filters",
    DEFAULT_FILTERS,
    isPartnerFilters,
  );
  const boardFilterCount =
    (boardFilters.term ? 1 : 0) +
    (boardFilters.domain ? 1 : 0) +
    (boardFilters.source ? 1 : 0) +
    (boardFilters.staleOnly ? 1 : 0) +
    (boardFilters.showPaused ? 0 : 1) +
    (boardFilters.showRejectedPastTerms ? 1 : 0);
  const resetBoardFilters = () => setBoardFilters(DEFAULT_FILTERS);

  // What the list view's Customize badge counts: every slice bar the search
  // box, which has its own visible field. Term counts only when it isn't
  // sitting on the loader's default scope (current & upcoming).
  const activeFilterCount =
    (stageFilter !== "all" ? 1 : 0) +
    (domainFilter !== "all" ? 1 : 0) +
    (selected !== UPCOMING ? 1 : 0);

  const setTerm = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("term", value);
    setSearchParams(next);
  };

  const resetFilters = () => {
    setStageFilter("all");
    setDomainFilter("all");
    const next = new URLSearchParams(searchParams);
    next.delete("term");
    setSearchParams(next);
  };

  const domainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      for (const d of r.domains) if (!seen.has(d.domainId)) seen.set(d.domainId, d.domainName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stageFilter !== "all" && r.stage !== stageFilter) return false;
      if (domainFilter !== "all" && !r.domains.some((d) => d.domainId === domainFilter))
        return false;
      // isAll → no term scope; otherwise a row matches if any target term is in
      // the resolved id set (single term or the current+upcoming set).
      if (!isAll && termIds && !r.targetTerms.some((t) => termIds.includes(t.id)))
        return false;
      if (!q) return true;
      if (r.title.toLowerCase().includes(q)) return true;
      if (r.partnerName.toLowerCase().includes(q)) return true;
      return r.domains.some((d) => d.domainName.toLowerCase().includes(q));
    });
  }, [rows, query, stageFilter, domainFilter, isAll, termIds]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <PartnerCrmNav />
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {view === "card" && (
            <>
              <SearchInput
                value={boardQuery}
                onChange={(e) => setBoardQuery(e.target.value)}
                placeholder="Search applications…"
                aria-label="Search the partner board"
                containerClassName="w-56 sm:w-72"
              />
              <Popover
                align="right"
                ariaLabel="Customize board"
                panelClassName={filterPanelClass(true)}
                trigger={
                  <button type="button" className={customizeButtonClass(true, boardFilterCount > 0)}>
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                    Customize
                    <FilterCountBadge os={true} count={boardFilterCount} />
                  </button>
                }
              >
                <div className="flex flex-col gap-4">
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <FilterSectionLabel os={true}>Filters</FilterSectionLabel>
                      {boardFilterCount > 0 && (
                        <FilterResetButton os={true} onClick={resetBoardFilters} />
                      )}
                    </div>

                    {boardTermOptions.length > 0 && (
                      <FilterGroup label="Term" os={true}>
                        <FilterPill
                          os={true}
                          selected={!boardFilters.term}
                          onClick={() => setBoardFilters((f) => ({ ...f, term: null }))}
                        >
                          All
                        </FilterPill>
                        {boardTermOptions.map((t) => (
                          <FilterPill
                            key={t.id}
                            os={true}
                            selected={boardFilters.term === t.id}
                            onClick={() => setBoardFilters((f) => ({ ...f, term: t.id }))}
                          >
                            {t.code}
                          </FilterPill>
                        ))}
                      </FilterGroup>
                    )}

                    {boardDomainOptions.length > 0 && (
                      <FilterGroup label="Domain" os={true}>
                        <FilterPill
                          os={true}
                          selected={!boardFilters.domain}
                          onClick={() => setBoardFilters((f) => ({ ...f, domain: null }))}
                        >
                          All
                        </FilterPill>
                        {boardDomainOptions.map((d) => (
                          <FilterPill
                            key={d.id}
                            os={true}
                            selected={boardFilters.domain === d.id}
                            onClick={() => setBoardFilters((f) => ({ ...f, domain: d.id }))}
                          >
                            {d.name}
                          </FilterPill>
                        ))}
                      </FilterGroup>
                    )}

                    <FilterGroup label="Source" os={true}>
                      <FilterPill
                        os={true}
                        selected={!boardFilters.source}
                        onClick={() => setBoardFilters((f) => ({ ...f, source: null }))}
                      >
                        All
                      </FilterPill>
                      {SOURCE_OPTIONS.map((s) => (
                        <FilterPill
                          key={s.value}
                          os={true}
                          selected={boardFilters.source === s.value}
                          onClick={() => setBoardFilters((f) => ({ ...f, source: s.value }))}
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
                      checked={boardFilters.staleOnly}
                      onChange={(checked) => setBoardFilters((f) => ({ ...f, staleOnly: checked }))}
                    />
                    <FilterToggleRow
                      label="Show paused"
                      os={true}
                      checked={boardFilters.showPaused}
                      onChange={(checked) => setBoardFilters((f) => ({ ...f, showPaused: checked }))}
                    />
                    <FilterToggleRow
                      label="Show rejected from past terms"
                      os={true}
                      checked={boardFilters.showRejectedPastTerms}
                      onChange={(checked) =>
                        setBoardFilters((f) => ({ ...f, showRejectedPastTerms: checked }))
                      }
                    />
                  </section>
                </div>
              </Popover>
            </>
          )}
          <ViewToggle
            value={view}
            onChange={(next) => {
              setView(next);
              // The board shows every status as a column; a lingering list
              // status filter would silently hide columns when switching back.
              if (next === "card") setStageFilter("all");
            }}
          />
          {canEdit && !creating && (
            <button type="button" onClick={() => setCreating(true)} className="os-add-btn">
              <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
              New application
            </button>
          )}
        </div>
      </div>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {view === "list" && creating && canEdit && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            New partner application
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Title</span>
              <input
                name="title"
                autoFocus
                required
                placeholder="What is the partner pitching?"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Applicant email</span>
              <input
                name="applicantEmail"
                type="email"
                required
                placeholder="contact@company.com"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Applicant name</span>
              <input
                name="applicantName"
                type="text"
                placeholder="Jane Smith (optional)"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="os-btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="os-btn-primary"
            >
              Create
            </button>
          </div>
        </Form>
      )}

      {/* List view keeps its own search/filters row below the nav row —
          board view has nothing between the nav row and the columns. */}
      {view === "list" && (
        <div className="flex items-center gap-4 flex-wrap">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, partner, or domain"
            containerClassName="flex-1 min-w-[200px] max-w-[420px]"
          />
          {/* Status, domain and term used to sit here as a row of selects
              that grew with the lab's domains and every term ever seeded.
              Behind one control the toolbar stays the width of the page,
              and the badge says how many slices are on so a filtered list
              is never silently filtered. */}
          <Popover
            align="left"
            ariaLabel="Customize applications"
            panelClassName={filterPanelClass(true)}
            trigger={
              <button
                type="button"
                className={customizeButtonClass(true, activeFilterCount > 0)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                Customize
                <FilterCountBadge os={true} count={activeFilterCount} />
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <FilterSectionLabel os={true}>Filters</FilterSectionLabel>
                {activeFilterCount > 0 && (
                  <FilterResetButton os={true} onClick={resetFilters} />
                )}
              </div>

              <FilterGroup label="Stage" os={true}>
                <FilterPill
                  os={true}
                  selected={stageFilter === "all"}
                  onClick={() => setStageFilter("all")}
                >
                  All
                </FilterPill>
                {STAGES.map((st) => (
                  <FilterPill
                    key={st}
                    os={true}
                    selected={stageFilter === st}
                    onClick={() => setStageFilter(st)}
                  >
                    {STAGE_LABEL[st]}
                  </FilterPill>
                ))}
              </FilterGroup>

              {domainOptions.length > 0 && (
                <FilterGroup label="Domain" os={true}>
                  <FilterPill
                    os={true}
                    selected={domainFilter === "all"}
                    onClick={() => setDomainFilter("all")}
                  >
                    All
                  </FilterPill>
                  {domainOptions.map((d) => (
                    <FilterPill
                      key={d.id}
                      os={true}
                      selected={domainFilter === d.id}
                      onClick={() => setDomainFilter(d.id)}
                    >
                      {d.name}
                    </FilterPill>
                  ))}
                </FilterGroup>
              )}

              {terms.length > 0 && (
                <FilterGroup label="Term" os={true}>
                  {termFilterOrder(terms, { includeUpcoming: true }).map((opt) => (
                    <FilterPill
                      key={opt.value}
                      os={true}
                      selected={selected === opt.value}
                      onClick={() => setTerm(opt.value)}
                    >
                      {opt.label}
                    </FilterPill>
                  ))}
                </FilterGroup>
              )}
            </div>
          </Popover>
          <span className="ml-auto text-muted-foreground text-base">
            {filtered.length}{" "}
            {filtered.length === 1 ? "application" : "applications"}
            {filtered.length !== rows.length ? ` of ${rows.length}` : ""}
          </span>
        </div>
      )}

      {view === "list" ? (
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">All applications</h2>
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "No partner applications yet."
                : "No applications match these filters."}
            </div>
          ) : (
            <ApplicationsTable rows={filtered} />
          )}
        </div>
      ) : (
        <PartnerBoard
          cards={cards}
          canEdit={canEdit}
          staleDays={staleDays}
          domainOptions={boardDomainOptions}
          termOptions={boardTermOptions}
          currentTermStartIso={currentTermStartIso}
          query={boardQuery}
          filters={boardFilters}
          isCreating={creating}
          onCreateClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function StagePill({ stage }: { stage: Status }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${PARTNER_STAGE_PILL[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

function ApplicationsTable({ rows }: { rows: ApplicationRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Title</th>
            <th className="text-left font-medium px-4 py-2">Partner</th>
            <th className="text-left font-medium px-4 py-2">Stage</th>
            <th className="text-left font-medium px-4 py-2">Target term</th>
            <th className="text-left font-medium px-4 py-2">Domains</th>
            <th className="text-right font-medium px-4 py-2">Expected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr
              key={a.id}
              onClick={() => {
                const url = `/core/partners/applications/${a.id}`;
                if (!requestOpenTabIfEmbedded(url, a.title)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <span className="text-foreground block">{a.title}</span>
                {a.excerpt && (
                  <span className="text-xs text-muted-foreground block truncate max-w-md">
                    {a.excerpt}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{a.partnerName}</td>
              <td className="px-4 py-2">
                <StagePill stage={a.stage} />
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.targetTerms.length > 0
                  ? a.targetTerms.map((t) => t.code).join(", ")
                  : "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.domains.length > 0
                  ? a.domains.map((d) => d.domainName).join(", ")
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right text-foreground tabular-nums">
                {a.totalExpectedMembers || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

