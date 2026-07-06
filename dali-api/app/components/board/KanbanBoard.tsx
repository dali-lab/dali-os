import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type KanbanColumn<TCard> = {
  /** Droppable id (status, projectId, UNASSIGNED, delib column). */
  id: string;
  title: ReactNode;
  /** e.g. "3 assigned", a count, a StatusPill. */
  subtitle?: ReactNode;
  cards: TCard[];
  /** Override shell classes per column (delibs color theming, staffing tone). */
  className?: string;
  /** Override the header container classes (delibs header theming). */
  headerClassName?: string;
  /** Override the card-list container classes (staffing scroll, delibs spacing). */
  listClassName?: string;
  /** Finalize button, count badge — rendered on the right of the header. */
  headerExtra?: ReactNode;
  /** Per-column count badge content. Defaults to the card count. */
  count?: ReactNode;
  /** Custom empty-state markup (delibs dashed box, staffing tall drop target). */
  renderEmpty?: () => ReactNode;
};

/** Props passed to `renderCard` so the card body wires drag + dragging state. */
export type KanbanCardRenderOpts = {
  isDragging: boolean;
  /**
   * Spread onto the element that should initiate a drag — a GripVertical handle
   * (TaskBoard) or the whole card body (Applications / Staffing). Empty when the
   * board is read-only.
   */
  dragHandleProps: Record<string, unknown>;
};

export type KanbanBoardProps<TCard> = {
  /** Fixed, unique per mounted board — keeps SSR/client dnd-kit ids deterministic. */
  id: string;
  columns: KanbanColumn<TCard>[];
  getCardId: (card: TCard) => string;
  /** Data attached to the draggable; surfaced on event.active.data.current. */
  getCardData: (card: TCard) => Record<string, unknown>;
  renderCard: (card: TCard, opts: KanbanCardRenderOpts) => ReactNode;
  /** false => read-only board (no drag listeners, no grab cursor). */
  draggable: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragCancel?: () => void;
  /** Opt in to within-column ordering (SortableContext + vertical strategy). */
  sortable?: boolean;
  /** Opt in to a DragOverlay (StaffingBoard's MemberCardPreview). */
  renderOverlay?: (activeCardId: string | null) => ReactNode;
  /** Layout: flex row (default) or CSS grid (delibs). */
  layout?: "row" | "grid";
  /** Activation distance for the pointer sensor (disambiguates click vs drag). */
  activationDistance?: number;
  /** Collision strategy. Defaults to closestCorners for sortable boards. */
  collisionDetection?: CollisionDetection;
  error?: string | null;
  emptyLabel?: ReactNode;
};

// The unified board primitive: owns the DndContext (with a fixed id so SSR and
// client agree — see the per-board comments below), the column row/shell, the
// coral `isOver` ring, the Empty placeholder, the destructive error banner, the
// draggable card wrapper, and the optional SortableContext + DragOverlay.
export function KanbanBoard<TCard>({
  id,
  columns,
  getCardId,
  getCardData,
  renderCard,
  draggable,
  onDragEnd,
  onDragStart,
  onDragCancel,
  sortable = false,
  renderOverlay,
  layout = "row",
  activationDistance = 6,
  collisionDetection,
  error,
  emptyLabel = "Empty",
}: KanbanBoardProps<TCard>) {
  // A small activation distance disambiguates a click from a drag: a press that
  // moves less than the threshold fires the card's onClick; past it a drag
  // starts and the click is suppressed. This replaces the bespoke
  // `wasDragging` click-suppression DelibsKanban used with native HTML5 drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: activationDistance } }),
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    if (renderOverlay) setActiveId(String(event.active.id));
    onDragStart?.(event);
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    onDragEnd(event);
  }
  function handleDragCancel() {
    setActiveId(null);
    onDragCancel?.();
  }

  const containerClass =
    layout === "grid" ? "grid gap-4" : "flex gap-3 overflow-x-auto pt-1 pb-3 px-0.5";
  const containerStyle: CSSProperties | undefined =
    layout === "grid"
      ? { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <DndContext
        id={id}
        sensors={sensors}
        collisionDetection={collisionDetection ?? (sortable ? closestCorners : undefined)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className={containerClass} style={containerStyle}>
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              getCardId={getCardId}
              getCardData={getCardData}
              renderCard={renderCard}
              draggable={draggable}
              sortable={sortable}
              usesOverlay={!!renderOverlay}
              layout={layout}
              emptyLabel={emptyLabel}
            />
          ))}
        </div>

        {renderOverlay && <DragOverlay>{renderOverlay(activeId)}</DragOverlay>}
      </DndContext>
    </div>
  );
}

function BoardColumn<TCard>({
  column,
  getCardId,
  getCardData,
  renderCard,
  draggable,
  sortable,
  usesOverlay,
  layout,
  emptyLabel,
}: {
  column: KanbanColumn<TCard>;
  getCardId: (card: TCard) => string;
  getCardData: (card: TCard) => Record<string, unknown>;
  renderCard: (card: TCard, opts: KanbanCardRenderOpts) => ReactNode;
  draggable: boolean;
  sortable: boolean;
  usesOverlay: boolean;
  layout: "row" | "grid";
  emptyLabel: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });
  const cardIds = column.cards.map(getCardId);

  // The flex-row shell every dnd-kit board shared (the three near-identical
  // spellings the boards had drifted into); grid columns (delibs) bring their
  // own shape via `className`. The coral `isOver` ring is applied uniformly.
  const shellClass =
    column.className ??
    "flex-shrink-0 w-64 border rounded-lg border-border bg-card flex flex-col";

  const list = (
    <>
      {column.cards.length === 0 ? (
        column.renderEmpty ? (
          column.renderEmpty()
        ) : (
          <div className="text-xs text-muted-foreground italic text-center py-4">
            {emptyLabel}
          </div>
        )
      ) : (
        column.cards.map((card) => (
          <CardWrapper
            key={getCardId(card)}
            card={card}
            getCardId={getCardId}
            getCardData={getCardData}
            renderCard={renderCard}
            draggable={draggable}
            sortable={sortable}
            usesOverlay={usesOverlay}
          />
        ))
      )}
    </>
  );

  return (
    <div
      ref={setNodeRef}
      className={`${shellClass} ${isOver ? "ring-2 ring-accent-coral/40" : ""}`}
    >
      <div
        className={
          column.headerClassName ??
          "px-3 py-2 border-b border-border flex items-center justify-between"
        }
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground truncate" title={
            typeof column.title === "string" ? column.title : undefined
          }>
            {column.title}
          </div>
          {column.subtitle != null && (
            <div className="text-[11px] text-muted-foreground">{column.subtitle}</div>
          )}
        </div>
        {column.headerExtra ?? (
          <div className="text-[11px] text-muted-foreground flex-shrink-0">
            {column.count ?? column.cards.length}
          </div>
        )}
      </div>

      <div
        className={
          column.listClassName ??
          (layout === "grid" ? "space-y-2" : "flex flex-col gap-2 p-2 min-h-[120px]")
        }
      >
        {sortable ? (
          <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        ) : (
          list
        )}
      </div>
    </div>
  );
}

function CardWrapper<TCard>({
  card,
  getCardId,
  getCardData,
  renderCard,
  draggable,
  sortable,
  usesOverlay,
}: {
  card: TCard;
  getCardId: (card: TCard) => string;
  getCardData: (card: TCard) => Record<string, unknown>;
  renderCard: (card: TCard, opts: KanbanCardRenderOpts) => ReactNode;
  draggable: boolean;
  sortable: boolean;
  usesOverlay: boolean;
}) {
  if (sortable) {
    return (
      <SortableCardWrapper
        card={card}
        getCardId={getCardId}
        getCardData={getCardData}
        renderCard={renderCard}
        draggable={draggable}
      />
    );
  }
  return (
    <DraggableCardWrapper
      card={card}
      getCardId={getCardId}
      getCardData={getCardData}
      renderCard={renderCard}
      draggable={draggable}
      usesOverlay={usesOverlay}
    />
  );
}

// Bare draggable wrapper (TaskBoard / Applications): no within-column reorder.
function DraggableCardWrapper<TCard>({
  card,
  getCardId,
  getCardData,
  renderCard,
  draggable,
  usesOverlay,
}: {
  card: TCard;
  getCardId: (card: TCard) => string;
  getCardData: (card: TCard) => Record<string, unknown>;
  renderCard: (card: TCard, opts: KanbanCardRenderOpts) => ReactNode;
  draggable: boolean;
  usesOverlay: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: getCardId(card),
    data: getCardData(card),
    disabled: !draggable,
  });

  // With a DragOverlay (delibs), the floating copy follows the pointer, so the
  // in-flow source must NOT also translate — it just dims. Without an overlay
  // (TaskBoard / Applications), the source itself follows the pointer.
  const style: CSSProperties =
    !usesOverlay && transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
      : {};
  const dragHandleProps = draggable
    ? ({ ...attributes, ...listeners } as Record<string, unknown>)
    : {};

  return (
    <div ref={setNodeRef} style={style}>
      {renderCard(card, { isDragging, dragHandleProps })}
    </div>
  );
}

// Sortable wrapper (StaffingBoard): siblings animate to make room; the dragged
// card is dimmed and its floating copy is rendered by the DragOverlay.
function SortableCardWrapper<TCard>({
  card,
  getCardId,
  getCardData,
  renderCard,
  draggable,
}: {
  card: TCard;
  getCardId: (card: TCard) => string;
  getCardData: (card: TCard) => Record<string, unknown>;
  renderCard: (card: TCard, opts: KanbanCardRenderOpts) => ReactNode;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: getCardId(card),
      data: getCardData(card),
      disabled: !draggable,
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const dragHandleProps = draggable
    ? ({ ...attributes, ...listeners } as Record<string, unknown>)
    : {};

  return (
    <div ref={setNodeRef} style={style}>
      {renderCard(card, { isDragging, dragHandleProps })}
    </div>
  );
}
