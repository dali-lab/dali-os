import type { CSSProperties } from "react";
import { ArrowUp, Folder, GripVertical, Plus, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { destinationKey } from "~/components/drive/picker-multi";
import { MAX_FILING_LINKS, type FilingPlace } from "~/calendar/components/meeting-note";

export type FilingSuggestionChip = { groupId: string; label: string; reason: string };

const rowClass = "flex items-center gap-2 rounded-md border border-border bg-muted/40 py-1 pl-1 pr-1 text-sm";

function PlaceRow({
  place,
  canMakeLocation,
  removable,
  onMakeLocation,
  onRemove,
}: {
  place: FilingPlace;
  canMakeLocation: boolean;
  removable: boolean;
  onMakeLocation: (place: FilingPlace) => void;
  onRemove: (place: FilingPlace) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: destinationKey(place.dest),
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="filed-in-chip"
      className={cn(rowClass, isDragging && "relative z-10 opacity-60 shadow-md")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${place.path}`}
        className="dnd-touch-handle shrink-0 cursor-grab rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground" title={place.path}>
        {place.path}
      </span>
      {canMakeLocation && (
        <IconButton
          label="Make location"
          icon={ArrowUp}
          tooltipSide="top"
          className="shrink-0 p-1"
          onClick={() => onMakeLocation(place)}
        />
      )}
      {removable && (
        <IconButton
          label={`Remove ${place.path}`}
          icon={X}
          tooltipSide="top"
          className="shrink-0 p-1"
          onClick={() => onRemove(place)}
        />
      )}
    </li>
  );
}

function PlainRow({ path, onRemove }: { path: string; onRemove?: () => void }) {
  return (
    <li data-testid="filed-in-chip" className={cn(rowClass, "pl-2")}>
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground" title={path}>
        {path}
      </span>
      {onRemove && (
        <IconButton
          label={`Remove ${path}`}
          icon={X}
          tooltipSide="top"
          className="shrink-0 p-1"
          onClick={onRemove}
        />
      )}
    </li>
  );
}

/**
 * Where the notebook lives and where it also appears. The list is ordered: the
 * top row is the location, the rest are shortcuts, and rows drag (or
 * keyboard-reorder) between the two. An existing notebook's own place seeds the
 * top; reordering so a different place is on top moves the notebook there. For a
 * whiteboard with no note there is one place and nothing to rank.
 */
export function FiledInChips({
  places,
  fixedLocation,
  lockTop = false,
  boardOnly = false,
  suggestions,
  labelClass,
  onPickSuggestion,
  onMakeLocation,
  onReorder,
  onRemove,
  onAdd,
}: {
  places: FilingPlace[];
  /** Set for an existing notebook whose location isn't a row in the list, so
   *  every place is a shortcut: the path of its own place when it can't be
   *  picked here (it stays put), or null before a notebook is chosen. */
  fixedLocation?: string | null;
  /** The top row is the notebook's own place: it can't be removed, only
   *  replaced by dragging another place above it. */
  lockTop?: boolean;
  boardOnly?: boolean;
  suggestions: FilingSuggestionChip[];
  labelClass: string;
  onPickSuggestion: (groupId: string) => void;
  onMakeLocation: (place: FilingPlace) => void;
  /** Moves the place at `from` to `to` in `places`. */
  onReorder: (from: number, to: number) => void;
  onRemove: (place: FilingPlace) => void;
  onAdd: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = places.map((p) => destinationKey(p.dest));
  const fixed = fixedLocation !== undefined;
  const locationCount = fixed ? 0 : Math.min(1, places.length);
  const location = places.slice(0, locationCount);
  const shortcuts = places.slice(locationCount);
  const shortcutOverflow = shortcuts.length - MAX_FILING_LINKS;

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorder(from, to);
  }

  const row = (place: FilingPlace, i: number) => (
    <PlaceRow
      key={ids[i]}
      place={place}
      canMakeLocation={!fixed && i >= locationCount}
      removable={!(lockTop && i === 0)}
      onMakeLocation={onMakeLocation}
      onRemove={onRemove}
    />
  );

  const suggestionList = suggestions.length > 0 && (
    <ul aria-label="Suggested places" className="mb-2 flex flex-wrap gap-1.5">
      {suggestions.map((s) => (
        <li key={s.groupId}>
          <button
            type="button"
            onClick={() => onPickSuggestion(s.groupId)}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60"
          >
            <Plus className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">
              Suggested: {s.label} · {s.reason}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (boardOnly) {
    return (
      <div>
        {suggestionList}
        <span className={labelClass}>Location</span>
        {places.length > 0 ? (
          <ul aria-label="Location" className="mb-2 flex flex-col gap-1">
            {places.map((place) => (
              <PlainRow key={destinationKey(place.dest)} path={place.path} onRemove={() => onRemove(place)} />
            ))}
          </ul>
        ) : (
          <p className="mb-2 text-xs text-muted-foreground">Goes in the default Meeting assets folder.</p>
        )}
        <Button variant="ghost" size="xs" onClick={onAdd} className="-ml-2.5">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {places.length > 0 ? "Change place…" : "Add a place…"}
        </Button>
      </div>
    );
  }

  return (
    <div>
      {suggestionList}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <span className={labelClass}>Location</span>
          {fixedLocation === null ? (
            <p className="mb-3 text-xs text-muted-foreground">Starts where the notebook you choose already lives.</p>
          ) : fixedLocation !== undefined ? (
            <ul aria-label="Location" className="mb-3 flex flex-col gap-1">
              <PlainRow path={fixedLocation} />
            </ul>
          ) : location.length > 0 ? (
            <ul aria-label="Location" className="mb-3 flex flex-col gap-1">
              {location.map((place, i) => row(place, i))}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-muted-foreground">Goes in the default Meetings folder.</p>
          )}
          <span className={labelClass}>Shortcuts</span>
          {shortcuts.length > 0 ? (
            <ul aria-label="Shortcuts" className="mb-2 flex flex-col gap-1">
              {shortcuts.map((place, i) => row(place, locationCount + i))}
            </ul>
          ) : (
            <p className="mb-2 text-xs text-muted-foreground">
              No shortcuts. Add places where this notebook should also appear.
            </p>
          )}
        </SortableContext>
      </DndContext>
      {shortcutOverflow > 0 && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          A notebook can have up to {MAX_FILING_LINKS} shortcuts. Remove {shortcutOverflow}.
        </p>
      )}
      <Button variant="ghost" size="xs" onClick={onAdd} className="-ml-2.5">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add a place…
      </Button>
    </div>
  );
}
