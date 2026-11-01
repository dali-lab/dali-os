import { useMemo, useState } from "react";
import { redirect, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/core.partners";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore, currentTerm } from "~/lib/roles";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PartnerBoard } from "../components/PartnerBoard";
import { PartnerApplicationModal } from "../components/PartnerApplicationModal";
import {
  ACTIVITY_OPTIONS,
  columnFiltersFromParams,
  DEFAULT_BOARD_PREFS,
  filterPartnerCards,
  isBoardPrefs,
  partnerCardCells,
  partnerFiltersFromColumns,
  SOURCE_OPTIONS,
  type PartnerBoardPrefs,
  type PartnerCardModel,
} from "../lib/partner-board";
import { SearchInput } from "~/components/ui/SearchInput";
import { usePersistedState } from "~/hooks/usePersistedState";
import {
  ColumnFilters,
  useColumnFilters,
  type FilterColumn,
} from "~/projects/components/ColumnFilters";
import { Activity, CalendarRange, Inbox, Plus, Settings, Shapes } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { PartnerSettingsModal } from "../components/PartnerSettingsModal";

// areaSubnav: this page mounts PartnerCrmNav itself at the top, so the shell
// must not add its own sub-nav row above it. fitViewport: the board's columns
// scroll internally, so the page itself must never grow the document.
export const handle = { hideBreadcrumbs: true, areaSubnav: true, fitViewport: true };

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
  const [prefs, setPrefs] = usePersistedState<PartnerBoardPrefs>(
    "dali:partnerboard:prefs",
    DEFAULT_BOARD_PREFS,
    isBoardPrefs,
  );

  const columns = useMemo<FilterColumn[]>(
    () => [
      { key: "term", label: "Term", icon: CalendarRange, order: termOptions.map((t) => t.code) },
      { key: "domain", label: "Domain", icon: Shapes },
      { key: "source", label: "Source", icon: Inbox, order: SOURCE_OPTIONS.map((s) => s.value) },
      { key: "activity", label: "Activity", icon: Activity, order: ACTIVITY_OPTIONS },
    ],
    [termOptions],
  );
  // Only the initial URL seeds the filters; later edits go through the builder.
  const [initialFilters] = useState(() =>
    columnFiltersFromParams(searchParams, {
      sources: SOURCE_OPTIONS.map((s) => s.value),
      terms: termOptions,
    }),
  );
  const columnFilters = useColumnFilters(columns, initialFilters);
  const filterRows = useMemo(
    () => cards.map((c) => ({ cells: partnerCardCells(c, staleDays) })),
    [cards, staleDays],
  );
  const filters = partnerFiltersFromColumns(columnFilters.active, prefs);
  const shownCount = useMemo(
    () => filterPartnerCards(cards, filters, query, { staleDays, currentTermStartIso }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, columnFilters.active, prefs, query, staleDays, currentTermStartIso],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <PartnerCrmNav className="shrink-0" />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applications…"
          aria-label="Search applications"
          containerClassName="flex-1 min-w-[180px] max-w-[320px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={columns}
            rows={filterRows}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={shownCount}
            noun={["application", "applications"]}
          />
        </div>
        <IconButton
          label="Partner settings"
          icon={Settings}
          onClick={() => setParam("settings", "1")}
          className="os-icon-btn"
        />
        <button type="button" onClick={() => setCreating(true)} className="os-btn-primary shrink-0 whitespace-nowrap">
          <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
          New application
        </button>
      </div>

      {settingsOpen && (
        <PartnerSettingsModal
          onClose={() => setParam("settings", null)}
          board={{ prefs, onChange: setPrefs }}
        />
      )}

      <PartnerBoard
          cards={cards}
          canEdit
          staleDays={staleDays}
          currentTermStartIso={currentTermStartIso}
          query={query}
          filters={filters}
          sort={prefs.sort}
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
