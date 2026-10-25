import { ArrowDown, ArrowUp, PlayCircle, Trash2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { richDocHas } from "~/journeys/lib/journey";
import type { LessonPage } from "~/journeys/lib/types";

export function PageListItem({
  page,
  index,
  total,
  active,
  onSelect,
  onMove,
  onDelete,
}: {
  page: LessonPage;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const title = page.title.trim() || "Untitled page";
  return (
    <li className={cn("group flex items-center rounded-os-item pr-1.5", active ? "bg-os-card" : "hover:bg-os-hover")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
      >
        <span className="w-5 shrink-0 tabular-nums text-os-muted">{index + 1}</span>
        <span className={cn("truncate", page.title.trim() ? (active ? "text-foreground" : "text-foreground/85") : "text-os-muted")}>
          {title}
        </span>
        {richDocHas(page.content, "video") && <PlayCircle className="h-3.5 w-3.5 shrink-0 text-os-muted" aria-label="Has video" />}
      </button>
      <span
        className={cn(
          "flex shrink-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        <IconButton label="Move page up" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton label="Move page down" icon={ArrowDown} disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton label={`Delete ${title}`} icon={Trash2} tone="destructive" onClick={onDelete} />
      </span>
    </li>
  );
}
