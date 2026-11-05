import { memo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Copy, EyeOff, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { ContextMenu, Popover } from "~/components/ui/floating";
import { ActionMenuItems } from "./ActionMenuItems";
import type { ActionSpec } from "./actions";
import { ScaledSlide } from "~/components/slides/deck/SlideRender";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { cn } from "~/lib/cn";
import { LayoutGrid } from "./LayoutPicker";
import type { SlidePeer } from "./useDeckDoc";

const Thumb = memo(function Thumb({ slide, themeId }: { slide: RenderSlide; themeId: string }) {
  return <ScaledSlide slide={slide} theme={themeId} className="pointer-events-none" />;
});

function PresenceDots({ peers }: { peers: SlidePeer[] }) {
  if (peers.length === 0) return null;
  return (
    <span className="absolute right-1 top-1 flex -space-x-1.5" data-testid="slide-presence">
      {peers.slice(0, 3).map((p) => (
        <Avatar key={p.clientId} name={p.name} photoUrl={p.photoUrl} size="xs" className="ring-2 ring-os-card" />
      ))}
    </span>
  );
}

function CommentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      data-testid="slide-comment-count"
      className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-os-accent px-1.5 text-[10px] font-semibold text-os-bg"
      aria-label={`${count} ${count === 1 ? "comment" : "comments"}`}
    >
      <MessageSquare className="h-2.5 w-2.5" aria-hidden />
      {count}
    </span>
  );
}

function Item({
  slide,
  index,
  themeId,
  active,
  peers,
  editable,
  commentCount,
  selected,
  actions,
  onSelect,
  onContext,
  onDuplicate,
  onDelete,
}: {
  slide: RenderSlide;
  index: number;
  themeId: string;
  active: boolean;
  peers: SlidePeer[];
  editable: boolean;
  commentCount: number;
  selected: boolean;
  actions?: () => ActionSpec[];
  onSelect: (mods: { shift: boolean; meta: boolean }) => void;
  onContext: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id, disabled: !editable });
  const thumbButton = (
    <button
      type="button"
      onClick={(e) => onSelect({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
      onContextMenu={onContext}
      aria-current={active ? "true" : undefined}
      aria-selected={selected || undefined}
      aria-label={`Slide ${index + 1}`}
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
  const thumb = actions ? (
    <ContextMenu ariaLabel={`Slide ${index + 1}`} items={<ActionMenuItems actions={actions()} />}>
      {thumbButton}
    </ContextMenu>
  ) : (
    thumbButton
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn("group", isDragging && "z-10 opacity-70")}
    >
      <div className="flex items-start gap-1.5">
        <span className="w-4 pt-1 text-right text-xs tabular-nums text-os-muted">{index + 1}</span>
        <div className="relative min-w-0 flex-1">
          {thumb}
          <CommentCount count={commentCount} />
          {slide.skipped && (
            <span data-testid="slide-skipped" className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-os-card/90 px-1.5 text-[10px] font-medium text-os-grey" aria-label="Skipped">
              <EyeOff className="h-2.5 w-2.5" aria-hidden />
              Skipped
            </span>
          )}
          <PresenceDots peers={peers} />
          {editable && (
            <span
              className={cn(
                "absolute bottom-1 right-1 flex gap-0.5 rounded-md bg-os-card/90 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100",
                active ? "opacity-100" : "opacity-0",
              )}
            >
              <IconButton label="Duplicate slide" icon={Copy} onClick={onDuplicate} />
              <IconButton label="Delete slide" icon={Trash2} tone="destructive" onClick={onDelete} />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function Filmstrip({
  slides,
  themeId,
  currentId,
  peers,
  editable,
  commentCounts,
  selectedIds = [],
  actionsFor,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
}: {
  slides: RenderSlide[];
  themeId: string;
  currentId: string | null;
  peers: Map<string, SlidePeer[]>;
  editable: boolean;
  onSelect: (id: string, mods: { shift: boolean; meta: boolean }) => void;
  onAdd: (layoutId: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Drops `id` (and the thumbnails selected with it) onto the thumbnail `overId`. */
  onMove: (id: string, overId: string) => void;
  commentCounts?: Map<string, number>;
  selectedIds?: string[];
  actionsFor?: (id: string) => ActionSpec[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(String(active.id), String(over.id));
  };
  return (
    <nav aria-label="Slides" className="flex min-h-0 w-44 shrink-0 flex-col gap-2 border-r border-os-container p-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-2">
              {slides.map((slide, i) => (
                <Item
                  key={slide.id}
                  slide={slide}
                  index={i}
                  themeId={themeId}
                  active={slide.id === currentId}
                  peers={peers.get(slide.id) ?? []}
                  editable={editable}
                  commentCount={commentCounts?.get(slide.id) ?? 0}
                  selected={selectedIds.includes(slide.id)}
                  actions={actionsFor ? () => actionsFor(slide.id) : undefined}
                  onSelect={(mods) => onSelect(slide.id, mods)}
                  onContext={() => !selectedIds.includes(slide.id) && onSelect(slide.id, { shift: false, meta: false })}
                  onDuplicate={() => onDuplicate(slide.id)}
                  onDelete={() => onDelete(slide.id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>
      {editable && (
        <Popover
          trigger={
            <Button variant="secondary" size="sm" className="w-full">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New slide
            </Button>
          }
          ariaLabel="Choose a layout"
        >
          {(close) => (
            <div className="w-56 p-2">
              <LayoutGrid
                onPick={(id) => {
                  onAdd(id);
                  close();
                }}
              />
            </div>
          )}
        </Popover>
      )}
    </nav>
  );
}
