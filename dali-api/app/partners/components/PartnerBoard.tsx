// The Partner CRM board — built the way TaskBoard is built
// (app/projects/components/TaskBoard.tsx): same KanbanBoard, same filter
// Popover kit, same optimistic-move hook, same column collapse/menu
// conventions. specs/partner-crm.md §4.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { Menu, MenuItem, Popover, Tooltip } from "~/components/ui/floating";
import { Confetti } from "~/components/Confetti";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { osStatusAccent, type StatusAccent } from "~/components/board/status-accent";
import { useOsChrome } from "~/components/os-chrome";
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
import { SearchInput } from "~/components/ui/SearchInput";
import { cn } from "~/lib/cn";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import { usePersistedState } from "~/hooks/usePersistedState";
import {
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  type PartnerStage,
} from "../lib/partner-application";
import {
  buildPartnerBoard,
  movePartnerInBoard,
  partnerMatchesQuery,
  type PartnerCardModel,
} from "../lib/partner-board";
import { PartnerCard } from "./PartnerCard";
import { PartnerApplicationModal } from "./PartnerApplicationModal";

const META_TEXT = (os: boolean) => (os ? "text-xs" : "text-[11px]");

const COLLAPSED_KEY = "partnerboard:collapsedCols";

// The os shell's accent reads the same status-token families TaskBoard draws
// its columns from, so the two boards share a palette. New~todo (not yet
// worked), Interview~progress, Accepted~done, Rejected~cancelled.
const STAGE_ACCENT_OS: Record<PartnerStage, StatusAccent> = {
  New: osStatusAccent("todo"),
  Interview: osStatusAccent("progress"),
  Accepted: osStatusAccent("done"),
  Rejected: osStatusAccent("cancelled"),
};

// The classic shell has no dark ground to tint against, so it keeps the soft
// fill TaskBoard's classic columns always used — same hues, mapped stage for
// stage onto the equivalent task-board column.
const STAGE_ACCENT_CLASSIC: Record<PartnerStage, StatusAccent> = {
  New: {
    fill: "color-mix(in srgb, #7c5ce0 22%, transparent)",
    ink: "#5734b8",
    edge: "#7c5ce0",
  },
  Interview: {
    fill: "color-mix(in srgb, var(--color-accent-teal) 22%, transparent)",
    ink: "#00706f",
    edge: "var(--color-accent-teal)",
  },
  Accepted: {
    fill: "color-mix(in srgb, var(--color-accent-green) 30%, transparent)",
    ink: "#166a41",
    edge: "var(--color-accent-green)",
  },
  Rejected: {
    fill: "color-mix(in srgb, var(--color-muted) 50%, transparent)",
    ink: "var(--color-muted-foreground)",
    edge: "var(--color-border)",
  },
};

const stageAccent = (stage: PartnerStage, os: boolean): StatusAccent =>
  (os ? STAGE_ACCENT_OS : STAGE_ACCENT_CLASSIC)[stage];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "Form", label: "Form" },
  { value: "Email", label: "Email" },
  { value: "Referral", label: "Referral" },
  { value: "Manual", label: "Manual" },
  { value: "Renewal", label: "Renewal" },
];

type PartnerFilters = {
  term: string | null;
  domain: string | null;
  source: string | null;
  staleOnly: boolean;
  showPaused: boolean;
  showRejectedPastTerms: boolean;
};

const DEFAULT_FILTERS: PartnerFilters = {
  term: null,
  domain: null,
  source: null,
  staleOnly: false,
  showPaused: true,
  showRejectedPastTerms: false,
};

function isPartnerFilters(v: unknown): v is PartnerFilters {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.term === null || typeof o.term === "string") &&
    (o.domain === null || typeof o.domain === "string") &&
    (o.source === null || typeof o.source === "string") &&
    typeof o.staleOnly === "boolean" &&
    typeof o.showPaused === "boolean" &&
    typeof o.showRejectedPastTerms === "boolean"
  );
}

export function PartnerBoard({
  cards: initialCards,
  canEdit,
  staleDays,
  domainOptions,
  termOptions,
  currentTermStartIso,
}: {
  cards: PartnerCardModel[];
  canEdit: boolean;
  staleDays: number;
  domainOptions: { id: string; name: string }[];
  termOptions: { id: string; code: string }[];
  /** Current term's start — "Show rejected from past terms" compares against it. Null when there is no current term. */
  currentTermStartIso: string | null;
}) {
  const { os } = useOsChrome();
  const { items: cards, move, error, setError } = useOptimisticBoardMove<PartnerCardModel>(initialCards);
  const revalidator = useRevalidator();
  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);

  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("application");
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = usePersistedState<PartnerFilters>(
    "dali:partnerboard:filters",
    DEFAULT_FILTERS,
    isPartnerFilters,
  );
  const [celebrate, setCelebrate] = useState(false);

  const [collapsedCols, setCollapsedCols] = useState<PartnerStage[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        setCollapsedCols(parsed.filter((s): s is PartnerStage => PARTNER_STAGES.includes(s as PartnerStage)));
      }
    } catch {
      /* unreadable / malformed: start expanded */
    }
  }, []);
  const persistCollapsed = useCallback((next: PartnerStage[]) => {
    setCollapsedCols(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* private-mode / storage-disabled: fall back to in-memory only */
    }
  }, []);
  const toggleCollapsed = useCallback(
    (stage: PartnerStage) =>
      persistCollapsed(
        collapsedCols.includes(stage)
          ? collapsedCols.filter((s) => s !== stage)
          : [...collapsedCols, stage],
      ),
    [collapsedCols, persistCollapsed],
  );

  const setOpenId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("application", id);
          else next.delete("application");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  const startCreate = useCallback(() => setIsCreating(true), []);
  const closeModal = useCallback(() => {
    setOpenId(null);
    setIsCreating(false);
  }, [setOpenId]);

  const currentTermStartMs = currentTermStartIso ? new Date(currentTermStartIso).getTime() : null;

  const filteredCards = useMemo(() => {
    let cs = cards;
    if (filters.term) cs = cs.filter((c) => c.targetTerms.some((t) => t.id === filters.term));
    if (filters.domain) cs = cs.filter((c) => c.domains.some((d) => d.id === filters.domain));
    if (filters.source) cs = cs.filter((c) => c.source === filters.source);
    if (filters.staleOnly) {
      const cutoff = staleDays * 24 * 60 * 60 * 1000;
      cs = cs.filter(
        (c) =>
          (c.stage === "New" || c.stage === "Interview") &&
          !c.holdUntil &&
          Date.now() - new Date(c.lastActivityAt).getTime() > cutoff,
      );
    }
    if (!filters.showPaused) {
      cs = cs.filter((c) => !c.holdUntil || new Date(c.holdUntil).getTime() <= Date.now());
    }
    if (!filters.showRejectedPastTerms && currentTermStartMs !== null) {
      cs = cs.filter(
        (c) =>
          c.stage !== "Rejected" || new Date(c.lastActivityAt).getTime() >= currentTermStartMs,
      );
    }
    if (query.trim()) cs = cs.filter((c) => partnerMatchesQuery(c, query));
    return cs;
  }, [cards, filters, query, staleDays, currentTermStartMs]);

  const board = useMemo(() => buildPartnerBoard(filteredCards), [filteredCards]);
  const openCard = openId ? cards.find((c) => c.id === openId) ?? null : null;

  async function persistMove(id: string, stage: PartnerStage, orderedIds: string[]): Promise<void> {
    const res = await fetch(`/api/partner-applications/${id}/move`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, orderedIds }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Request failed: ${res.status}`);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as
      | { applicationId?: string; fromStage?: PartnerStage }
      | undefined;
    const id = data?.applicationId;
    const fromStage = data?.fromStage;
    if (!id || !fromStage) return;

    let toStage: PartnerStage;
    let targetIndex: number;
    if (PARTNER_STAGES.includes(overId as PartnerStage)) {
      toStage = overId as PartnerStage;
      if (toStage === fromStage) return;
      targetIndex = -1;
    } else {
      const overCard = cards.find((c) => c.id === overId);
      if (!overCard || overCard.id === id) return;
      toStage = overCard.stage;
      targetIndex = buildPartnerBoard(cards)[toStage].findIndex((c) => c.id === overId);
    }

    const orderedIds = movePartnerInBoard(cards, id, toStage, targetIndex).orderedIds;
    move(
      (cur) => movePartnerInBoard(cur, id, toStage, targetIndex).cards,
      () => persistMove(id, toStage, orderedIds).then(refresh),
    );
    if (toStage === "Accepted" && fromStage !== "Accepted") setCelebrate(true);
  }

  const activeFilterCount =
    (filters.term ? 1 : 0) +
    (filters.domain ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.staleOnly ? 1 : 0) +
    (filters.showPaused ? 0 : 1) +
    (filters.showRejectedPastTerms ? 1 : 0);

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  const columns: KanbanColumn<PartnerCardModel>[] = PARTNER_STAGES.map((stage) => {
    const accent = stageAccent(stage, os);
    const label = PARTNER_STAGE_LABELS[stage];
    const stageCards = board[stage] ?? [];
    const collapsed = collapsedCols.includes(stage);
    const roundedTop = os ? "rounded-t-os-item" : "rounded-t-lg";
    const shell = os
      ? "flex-shrink-0 border border-transparent rounded-os-item bg-os-card flex flex-col"
      : "flex-shrink-0 border rounded-lg border-border bg-card flex flex-col";

    if (collapsed) {
      return {
        id: stage,
        title: null,
        className: cn(shell, "w-11"),
        headerClassName: cn("flex items-center justify-center px-1 py-2", roundedTop),
        headerStyle: { background: accent.fill, color: accent.ink },
        headerExtra: (
          <Tooltip content={`Expand ${label}`}>
            <button
              type="button"
              onClick={() => toggleCollapsed(stage)}
              className="rounded p-0.5 text-current hover:bg-current/10"
              aria-label={`Expand ${label} column`}
            >
              <ChevronsRight className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        ),
        cards: [],
        listClassName: "flex flex-1 flex-col items-center gap-2 py-3",
        renderEmpty: () => (
          <Tooltip content={`Expand ${label}`}>
            <button
              type="button"
              onClick={() => toggleCollapsed(stage)}
              className="flex flex-1 flex-col items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <span className={cn(META_TEXT(os), "font-medium")}>{stageCards.length}</span>
              <span
                className={cn("whitespace-nowrap", os ? "text-sm" : "text-xs")}
                style={{ writingMode: "vertical-rl" }}
              >
                {label}
              </span>
            </button>
          </Tooltip>
        ),
      };
    }

    return {
      id: stage,
      title: <span className="text-sm font-medium">{label}</span>,
      className: cn(shell, "w-full md:flex-1 md:min-w-[15rem]"),
      headerClassName: cn("flex items-center justify-between gap-2 px-3 py-2", roundedTop),
      headerStyle: { background: accent.fill, color: accent.ink },
      headerExtra: (
        <div className="flex shrink-0 items-center gap-1 text-current">
          <span
            className={cn(
              "rounded-full border border-current/30 px-2 py-0.5 font-medium tabular-nums",
              META_TEXT(os),
            )}
          >
            {stageCards.length}
          </span>
          <Menu
            align="right"
            ariaLabel={`${label} column actions`}
            trigger={
              <button
                type="button"
                className="rounded p-0.5 text-current hover:bg-current/10"
                aria-label={`${label} column actions`}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            }
          >
            {canEdit && (
              <MenuItem icon={<Plus className="h-4 w-4" aria-hidden />} onSelect={startCreate}>
                Add application
              </MenuItem>
            )}
            <MenuItem
              icon={<ChevronsLeft className="h-4 w-4" aria-hidden />}
              onSelect={() => toggleCollapsed(stage)}
            >
              Collapse column
            </MenuItem>
          </Menu>
        </div>
      ),
      cards: stageCards,
      listClassName:
        "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
      listHeader: canEdit ? (
        <button
          type="button"
          onClick={startCreate}
          className={cn(
            "mb-2 flex w-full items-center justify-center gap-1.5 border border-dashed transition-colors",
            META_TEXT(os),
            os
              ? "rounded-os-item border-os-container py-2 text-os-grey hover:border-os-container-hi hover:bg-os-container/30 hover:text-foreground"
              : "rounded-md border-border py-1.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground",
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add new
        </button>
      ) : null,
    };
  });

  return (
    <div className={cn("flex flex-col", os ? "gap-4" : "gap-3")}>
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <div className={cn("flex min-w-0 items-center", os ? "gap-3" : "gap-2")}>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applications…"
          aria-label="Search the partner board"
          containerClassName={cn("shrink-0", os ? "w-56 sm:w-72" : "w-44 sm:w-56")}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Popover
            align="right"
            ariaLabel="Customize board"
            panelClassName={filterPanelClass(os)}
            trigger={
              <button type="button" className={customizeButtonClass(os, activeFilterCount > 0)}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                Customize
                <FilterCountBadge os={os} count={activeFilterCount} />
              </button>
            }
          >
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <FilterSectionLabel os={os}>Filters</FilterSectionLabel>
                  {activeFilterCount > 0 && <FilterResetButton os={os} onClick={resetFilters} />}
                </div>

                {termOptions.length > 0 && (
                  <FilterGroup label="Term" os={os}>
                    <FilterPill os={os} selected={!filters.term} onClick={() => setFilters((f) => ({ ...f, term: null }))}>
                      All
                    </FilterPill>
                    {termOptions.map((t) => (
                      <FilterPill
                        key={t.id}
                        os={os}
                        selected={filters.term === t.id}
                        onClick={() => setFilters((f) => ({ ...f, term: t.id }))}
                      >
                        {t.code}
                      </FilterPill>
                    ))}
                  </FilterGroup>
                )}

                {domainOptions.length > 0 && (
                  <FilterGroup label="Domain" os={os}>
                    <FilterPill os={os} selected={!filters.domain} onClick={() => setFilters((f) => ({ ...f, domain: null }))}>
                      All
                    </FilterPill>
                    {domainOptions.map((d) => (
                      <FilterPill
                        key={d.id}
                        os={os}
                        selected={filters.domain === d.id}
                        onClick={() => setFilters((f) => ({ ...f, domain: d.id }))}
                      >
                        {d.name}
                      </FilterPill>
                    ))}
                  </FilterGroup>
                )}

                <FilterGroup label="Source" os={os}>
                  <FilterPill os={os} selected={!filters.source} onClick={() => setFilters((f) => ({ ...f, source: null }))}>
                    All
                  </FilterPill>
                  {SOURCE_OPTIONS.map((s) => (
                    <FilterPill
                      key={s.value}
                      os={os}
                      selected={filters.source === s.value}
                      onClick={() => setFilters((f) => ({ ...f, source: s.value }))}
                    >
                      {s.label}
                    </FilterPill>
                  ))}
                </FilterGroup>
              </section>

              <section className={cn("flex flex-col gap-3 border-t pt-3", os ? "border-os-container" : "border-border")}>
                <FilterSectionLabel os={os}>Visibility</FilterSectionLabel>
                <FilterToggleRow
                  label="Stale only"
                  os={os}
                  checked={filters.staleOnly}
                  onChange={(checked) => setFilters((f) => ({ ...f, staleOnly: checked }))}
                />
                <FilterToggleRow
                  label="Show paused"
                  os={os}
                  checked={filters.showPaused}
                  onChange={(checked) => setFilters((f) => ({ ...f, showPaused: checked }))}
                />
                <FilterToggleRow
                  label="Show rejected from past terms"
                  os={os}
                  checked={filters.showRejectedPastTerms}
                  onChange={(checked) => setFilters((f) => ({ ...f, showRejectedPastTerms: checked }))}
                />
              </section>
            </div>
          </Popover>
        </div>
      </div>

      {query.trim() && filteredCards.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No applications match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      <KanbanBoard<PartnerCardModel>
        id="partner-board"
        columns={columns}
        getCardId={(c) => c.id}
        getCardData={(c) => ({ applicationId: c.id, fromStage: c.stage })}
        draggable={canEdit}
        sortable
        dropPlaceholder
        onDragEnd={handleDragEnd}
        error={error}
        renderOverlay={(activeId) => {
          const c = activeId ? cards.find((x) => x.id === activeId) : null;
          return c ? (
            <div className="w-64 rotate-1 shadow-xl">
              <PartnerCard card={c} accentEdge={stageAccent(c.stage, os).edge} staleDays={staleDays} isDragging={false} onOpen={() => {}} />
            </div>
          ) : null;
        }}
        renderCard={(c, { isDragging, dragHandleProps }) => (
          <PartnerCard
            card={c}
            accentEdge={stageAccent(c.stage, os).edge}
            staleDays={staleDays}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            onOpen={() => setOpenId(c.id)}
          />
        )}
      />

      {(openCard || isCreating) && (
        <PartnerApplicationModal
          card={openCard}
          canEdit={canEdit}
          domainOptions={domainOptions}
          termOptions={termOptions}
          onClose={closeModal}
          onChanged={() => {
            setError(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
