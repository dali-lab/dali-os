// The Partner CRM board — built the way TaskBoard is built
// (app/projects/components/TaskBoard.tsx): same KanbanBoard, same filter
// Popover kit, same optimistic-move hook, same column collapse/menu
// conventions. specs/partner-crm.md §4.

import { useCallback, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { ChevronsLeft, ChevronsRight, MoreHorizontal } from "lucide-react";
import { Menu, MenuItem, Tooltip } from "~/components/ui/floating";
import { Confetti } from "~/components/Confetti";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import {
  BOARD_TITLE_CLASS,
  boardTitleStyle,
  osStatusAccent,
  type StatusAccent,
} from "~/components/board/status-accent";
import { cn } from "~/lib/cn";
import { isList, listCodec, usePersistedState } from "~/hooks/usePersistedState";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import {
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  type PartnerStage,
} from "../lib/partner-application";
import {
  buildPartnerBoard,
  filterPartnerCards,
  movePartnerInBoard,
  sortPartnerBoard,
  type PartnerCardModel,
  type PartnerCardSort,
  type PartnerFilters,
} from "../lib/partner-board";
import { PartnerCard } from "./PartnerCard";

const META_TEXT = "text-xs";

const COLLAPSED_KEY = "partnerboard:collapsedCols";
const stageListCodec = listCodec<PartnerStage>((v): v is PartnerStage => PARTNER_STAGES.includes(v as PartnerStage));

// The os shell's accent reads the same status-token families TaskBoard draws
// its columns from, so the two boards share a palette. Backlog~backlog,
// New~todo (not yet worked), Interview~progress, Deciding~review,
// Accepted~done, Rejected~cancelled.
const STAGE_ACCENT: Record<PartnerStage, StatusAccent> = {
  Backlog: osStatusAccent("backlog"),
  New: osStatusAccent("todo"),
  Interview: osStatusAccent("progress"),
  Deciding: osStatusAccent("review"),
  Accepted: osStatusAccent("done"),
  Rejected: osStatusAccent("cancelled"),
};

export const stageAccent = (stage: PartnerStage): StatusAccent => STAGE_ACCENT[stage];

export function PartnerBoard({
  cards: initialCards,
  canEdit,
  staleDays,
  currentTermStartIso,
  query,
  filters,
  sort,
  onOpen,
}: {
  cards: PartnerCardModel[];
  canEdit: boolean;
  staleDays: number;
  currentTermStartIso: string | null;
  query: string;
  filters: PartnerFilters;
  sort: PartnerCardSort;
  onOpen: (id: string) => void;
}) {
  const { items: cards, move, error } = useOptimisticBoardMove<PartnerCardModel>(initialCards);
  const revalidator = useRevalidator();
  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);

  const [celebrate, setCelebrate] = useState(false);

  const [collapsedCols, persistCollapsed] = usePersistedState<PartnerStage[]>(
    COLLAPSED_KEY,
    [],
    isList<PartnerStage>,
    stageListCodec,
  );
  const toggleCollapsed = useCallback(
    (stage: PartnerStage) =>
      persistCollapsed(
        collapsedCols.includes(stage)
          ? collapsedCols.filter((s) => s !== stage)
          : [...collapsedCols, stage],
      ),
    [collapsedCols, persistCollapsed],
  );

  const filteredCards = useMemo(
    () => filterPartnerCards(cards, filters, query, { staleDays, currentTermStartIso }),
    [cards, filters, query, staleDays, currentTermStartIso],
  );

  const manualSort = sort === "manual";
  const board = useMemo(
    () => sortPartnerBoard(buildPartnerBoard(filteredCards), sort),
    [filteredCards, sort],
  );

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
      if (!manualSort && toStage === fromStage) return;
      targetIndex = manualSort
        ? buildPartnerBoard(cards)[toStage].findIndex((c) => c.id === overId)
        : -1;
    }

    const orderedIds = movePartnerInBoard(cards, id, toStage, targetIndex).orderedIds;
    move(
      (cur) => movePartnerInBoard(cur, id, toStage, targetIndex).cards,
      () => persistMove(id, toStage, orderedIds).then(refresh),
    );
    if (toStage === "Accepted" && fromStage !== "Accepted") setCelebrate(true);
  }

  const columns: KanbanColumn<PartnerCardModel>[] = PARTNER_STAGES.map((stage) => {
    const accent = stageAccent(stage);
    const label = PARTNER_STAGE_LABELS[stage];
    const stageCards = board[stage] ?? [];
    const collapsed = collapsedCols.includes(stage);
    const roundedTop = "rounded-t-os-item";
    const shell = "flex-shrink-0 border border-transparent rounded-os-item bg-os-card flex flex-col";

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
              <span className={cn(META_TEXT, "font-medium")}>{stageCards.length}</span>
              <span
                className="whitespace-nowrap text-sm"
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
      title: (
        <span className={cn("text-sm font-medium", BOARD_TITLE_CLASS)} style={boardTitleStyle(accent)}>
          {label}
        </span>
      ),
      className: cn(shell, "w-full md:flex-1 md:min-w-[15rem]"),
      headerClassName: cn("flex items-center justify-between gap-2 px-3 py-2", roundedTop),
      headerStyle: { background: accent.fill, color: accent.ink },
      headerExtra: (
        <div className="flex shrink-0 items-center gap-1 text-current">
          <span
            className={cn(
              "rounded-full border border-current/30 px-2 py-0.5 font-medium tabular-nums",
              META_TEXT,
            )}
            style={{ color: accent.ink }}
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
      // Below md the columns stack and cap themselves; from md up the
      // fitViewport page hands them the remaining height and they scroll inside.
      listClassName:
        "flex flex-col gap-2 p-2 overflow-y-auto min-h-[240px] max-h-[calc(100dvh-14rem)] md:min-h-0 md:max-h-none md:flex-1",
    };
  });

  return (
    <div className={"flex flex-col gap-4 md:min-h-0 md:flex-1"}>
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />

      {query.trim() && filteredCards.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No applications match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      <KanbanBoard<PartnerCardModel>
        id="partner-board"
        fillHeight
        columns={columns}
        getCardId={(c) => c.id}
        getCardData={(c) => ({ applicationId: c.id, fromStage: c.stage })}
        draggable={canEdit}
        sortable={manualSort}
        dropPlaceholder={manualSort}
        onDragEnd={handleDragEnd}
        error={error}
        renderOverlay={(activeId) => {
          const c = activeId ? cards.find((x) => x.id === activeId) : null;
          return c ? (
            <div className="w-64 rotate-1 shadow-xl">
              <PartnerCard card={c} accentEdge={stageAccent(c.stage).edge} staleDays={staleDays} isDragging={false} onOpen={() => {}} />
            </div>
          ) : null;
        }}
        renderCard={(c, { isDragging, dragHandleProps }) => (
          <PartnerCard
            card={c}
            accentEdge={stageAccent(c.stage).edge}
            staleDays={staleDays}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            onOpen={() => onOpen(c.id)}
          />
        )}
      />
    </div>
  );
}
