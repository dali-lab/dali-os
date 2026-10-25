import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import type { Slide } from "~/components/slides/types";
import { SlideCanvas } from "~/components/slides/SlideCanvas";

export function SlideThumbnail({
  slide,
  index,
  total,
  active,
  onSelect,
  onMove,
  onDuplicate,
  onDelete,
}: {
  slide: Slide;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group">
      <div className="flex items-start gap-2">
        <span className="w-5 pt-1 text-right text-xs tabular-nums text-os-muted">{index + 1}</span>
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          aria-label={`Slide ${index + 1}${slide.title.trim() ? `: ${slide.title}` : ""}`}
          className={cn(
            "min-w-0 flex-1 overflow-hidden rounded-lg ring-2 transition-shadow",
            active ? "ring-os-accent" : "ring-transparent hover:ring-os-container",
          )}
        >
          <SlideCanvas slide={slide} className="pointer-events-none" />
        </button>
      </div>
      <div
        className={cn(
          "mt-1 flex justify-end gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        <IconButton label="Move up" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton label="Move down" icon={ArrowDown} disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton label="Duplicate" icon={Copy} onClick={onDuplicate} />
        <IconButton label="Delete slide" icon={Trash2} tone="destructive" onClick={onDelete} />
      </div>
    </li>
  );
}
