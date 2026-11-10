import { memo } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { EyeOff } from "lucide-react";
import { ContextMenu } from "~/components/ui/floating";
import { ScaledSlide } from "~/components/slides/deck/SlideRender";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { cn } from "~/lib/cn";
import { ActionMenuItems } from "./ActionMenuItems";
import type { ActionSpec } from "./actions";

const Thumb = memo(function Thumb({ slide, themeId }: { slide: RenderSlide; themeId: string }) {
  return <ScaledSlide slide={slide} theme={themeId} className="pointer-events-none" />;
});

function Cell({
  slide,
  index,
  themeId,
  active,
  selected,
  editable,
  actions,
  onSelect,
  onOpen,
  onContext,
}: {
  slide: RenderSlide;
  index: number;
  themeId: string;
  active: boolean;
  selected: boolean;
  editable: boolean;
  actions?: () => ActionSpec[];
  onSelect: (mods: { shift: boolean; meta: boolean }) => void;
  onOpen: () => void;
  onContext: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id, disabled: !editable });
  const button = (
    <button
      type="button"
      onClick={(e) => onSelect({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      aria-label={`Slide ${index + 1}`}
      aria-current={active ? "true" : undefined}
      aria-selected={selected || undefined}
      className={cn(
        "block w-full overflow-hidden rounded-lg ring-2 transition-shadow",
        active ? "ring-os-accent" : selected ? "ring-os-accent/50" : "ring-transparent hover:ring-os-container",
        slide.skipped && "opacity-50",
      )}
      {...(editable ? { ...attributes, ...listeners } : {})}
    >
      <Thumb slide={slide} themeId={themeId} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      data-grid-slide={slide.id}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn("relative flex flex-col gap-1", isDragging && "z-10 opacity-70")}
    >
      {slide.section && <span className="truncate text-xs font-medium text-os-grey">{slide.section}</span>}
      {actions ? (
        <ContextMenu ariaLabel={`Slide ${index + 1}`} items={<ActionMenuItems actions={actions()} />}>
          {button}
        </ContextMenu>
      ) : (
        button
      )}
      <span className="flex items-center gap-1 text-xs tabular-nums text-os-muted">
        {index + 1}
        {slide.skipped && <EyeOff className="h-3 w-3" aria-label="Skipped" />}
      </span>
    </li>
  );
}

/** Every slide at once. Drag to reorder (the whole selection goes together), double-click to open one. */
export function GridView({
  slides,
  themeId,
  currentId,
  selectedIds,
  editable,
  actionsFor,
  onSelect,
  onMove,
  onOpen,
}: {
  slides: RenderSlide[];
  themeId: string;
  currentId: string | null;
  selectedIds: string[];
  editable: boolean;
  actionsFor?: (id: string) => ActionSpec[];
  onSelect: (id: string, mods: { shift: boolean; meta: boolean }) => void;
  onMove: (id: string, overId: string) => void;
  onOpen: (id: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
  };
  return (
    <div data-slide-grid role="region" aria-label="All slides" className="min-h-0 flex-1 overflow-y-auto p-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
          <ol className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}>
            {slides.map((slide, i) => (
              <Cell
                key={slide.id}
                slide={slide}
                index={i}
                themeId={themeId}
                active={slide.id === currentId}
                selected={selectedIds.includes(slide.id)}
                editable={editable}
                actions={actionsFor ? () => actionsFor(slide.id) : undefined}
                onSelect={(mods) => onSelect(slide.id, mods)}
                onOpen={() => onOpen(slide.id)}
                onContext={() => !selectedIds.includes(slide.id) && onSelect(slide.id, { shift: false, meta: false })}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
