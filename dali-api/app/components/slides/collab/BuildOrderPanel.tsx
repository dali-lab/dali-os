import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BarChart3, Group, GripVertical, Image as ImageIcon, ListChecks, Shapes, Square, Type, Video, X, type LucideIcon } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { BUILD_EFFECTS, MAX_BUILD_DELAY, type BuildEffect } from "~/components/slides/deck/builds";
import { buildRows, clampDelay, planBuilds, reorderRows, REMOVED, withoutRow, type BuildMode, type BuildPatch, type BuildRow } from "~/components/slides/deck/build-order";
import type { RenderSlide } from "~/components/slides/deck/snapshot";

const ICONS: Record<string, LucideIcon> = { text: Type, image: ImageIcon, shape: Square, chart: BarChart3, icon: Shapes, video: Video, poll: ListChecks, group: Group };
const EFFECT_LABEL: Record<BuildEffect, string> = { appear: "Appear", fade: "Fade", rise: "Rise", scale: "Scale" };
const EFFECT_OPTIONS = BUILD_EFFECTS.map((value) => ({ value, label: EFFECT_LABEL[value] }));

export interface BuildOrderPanelProps {
  slide: RenderSlide;
  selection: string[];
  editable: boolean;
  onApply: (patches: Record<string, BuildPatch>) => void;
  onEffect: (id: string, effect: BuildEffect) => void;
  onSelect: (ids: string[]) => void;
}

interface RowProps {
  row: BuildRow;
  stepLabel: string | null;
  first: boolean;
  selected: boolean;
  editable: boolean;
  onMode: (mode: BuildMode) => void;
  onDelay: (ms: number) => void;
  onEffect: (effect: BuildEffect) => void;
  onRemove: () => void;
  onSelect: () => void;
}

function Row({ row, stepLabel, first, selected, editable, onMode, onDelay, onEffect, onRemove, onSelect }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !editable });
  const Icon = ICONS[row.kind] ?? Square;
  const modes: Array<{ value: BuildMode; label: string; disabled?: boolean }> = [
    { value: "click", label: "On click" },
    { value: "with", label: "With previous", disabled: first },
    { value: "after", label: "After previous" },
  ];
  return (
    <li
      ref={setNodeRef}
      data-build-row={row.id}
      data-build-mode={row.mode}
      aria-current={selected ? "true" : undefined}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn(
        "flex flex-col gap-1.5 rounded-os-item border p-1.5",
        row.mode === "with" && "ml-4",
        selected ? "border-os-accent bg-os-hover" : "border-os-container",
        isDragging && "opacity-60",
      )}
    >
      {stepLabel && <span className="text-[11px] font-medium text-os-grey">{stepLabel}</span>}
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`Drag ${row.label}`} disabled={!editable} className="shrink-0 cursor-grab text-os-grey disabled:cursor-default" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-os-fg" aria-label={`Select ${row.label}`}>
          <Icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
          <span className="truncate">{row.label}</span>
          {row.bullets && <span className="shrink-0 text-xs text-os-grey">{row.span} bullets</span>}
        </button>
        {editable && <IconButton label={`Remove ${row.label} from builds`} icon={X} onClick={onRemove} />}
      </div>
      {editable && (
        <div className="flex flex-col gap-1">
          <Select ariaLabel={`Start ${row.label}`} value={row.mode} options={modes} onChange={(v) => onMode(v as BuildMode)} />
          <Select ariaLabel={`Effect ${row.label}`} value={row.effect} options={EFFECT_OPTIONS} onChange={(v) => onEffect(v as BuildEffect)} />
          {row.mode === "after" && (
            <label className="flex items-center justify-between gap-2 text-xs text-os-grey">
              Delay in seconds
              <input
                type="number"
                min={0}
                max={MAX_BUILD_DELAY / 1000}
                step={0.5}
                value={row.delay / 1000}
                aria-label={`Delay ${row.label}`}
                onChange={(e) => onDelay(clampDelay(Number(e.target.value) * 1000))}
                className="w-16 rounded-os-item border border-os-container bg-os-bg px-1.5 py-1 text-right text-sm text-os-fg"
              />
            </label>
          )}
        </div>
      )}
    </li>
  );
}

export function BuildOrderPanel({ slide, selection, editable, onApply, onEffect, onSelect }: BuildOrderPanelProps) {
  const rows = buildRows(slide);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  if (rows.length === 0) return <p className="text-sm text-os-grey">Nothing builds on this slide. Choose a step under Appears for an item.</p>;

  const apply = (next: BuildRow[]) => onApply(planBuilds(next));
  const patchRow = (id: string, patch: Partial<BuildRow>) => apply(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onApply({ ...planBuilds(withoutRow(rows, id)), [id]: REMOVED });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) apply(reorderRows(rows, String(active.id), String(over.id)));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-1.5" aria-label="Build order">
          {rows.map((row, i) => {
            const startsGroup = row.mode !== "with";
            return (
              <Row
                key={row.id}
                row={row}
                stepLabel={startsGroup ? (row.mode === "after" ? `Step ${row.start}, after previous` : `Step ${row.start}`) : null}
                first={i === 0}
                selected={selection.includes(row.id)}
                editable={editable}
                onMode={(mode) => patchRow(row.id, { mode })}
                onDelay={(delay) => patchRow(row.id, { delay })}
                onEffect={(effect) => onEffect(row.id, effect)}
                onRemove={() => remove(row.id)}
                onSelect={() => onSelect([row.id])}
              />
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
