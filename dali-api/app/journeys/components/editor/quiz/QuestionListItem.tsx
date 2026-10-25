import { ArrowDown, ArrowUp, CircleDot, PenLine, Trash2 } from "lucide-react";
import type { QuizQuestion } from "~/journeys/lib/types";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";

export function QuestionListItem({
  question,
  index,
  total,
  active,
  onSelect,
  onMove,
  onDelete,
}: {
  question: QuizQuestion;
  index: number;
  total: number;
  active: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const Icon = question.type === "multiple-choice" ? CircleDot : PenLine;
  const prompt = question.prompt.trim();

  return (
    <li className={cn("group flex items-center rounded-os-item pr-1.5", active ? "bg-os-card" : "hover:bg-os-hover")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
      >
        <span className="w-5 shrink-0 tabular-nums text-os-muted">{index + 1}</span>
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-os-muted"
          aria-label={question.type === "multiple-choice" ? "Multiple choice" : "Short answer"}
        />
        <span className={cn("truncate", prompt ? (active ? "text-foreground" : "text-foreground/85") : "text-os-muted")}>
          {prompt || "Untitled question"}
        </span>
      </button>
      <span
        className={cn(
          "flex shrink-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        <IconButton label="Move up" icon={ArrowUp} disabled={index === 0} onClick={() => onMove(-1)} iconClassName="h-3.5 w-3.5" />
        <IconButton label="Move down" icon={ArrowDown} disabled={index === total - 1} onClick={() => onMove(1)} iconClassName="h-3.5 w-3.5" />
        <IconButton label="Delete question" icon={Trash2} tone="destructive" onClick={onDelete} iconClassName="h-3.5 w-3.5" />
      </span>
    </li>
  );
}
