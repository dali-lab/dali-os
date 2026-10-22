import { SmilePlus } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ReactionSummary } from "~/lib/feedback";
import { IconButton } from "~/components/ui/IconButton";
import { Popover } from "~/components/ui/floating";

/** Emoji chips with counts, then a picker for adding one. Shared by Feedback and Gallery. */
export function ReactionBar({
  reactions,
  palette,
  onReact,
  className,
}: {
  reactions: ReactionSummary[];
  palette: readonly string[];
  onReact: (emoji: string) => void;
  className?: string;
}) {
  const chip =
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors";
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}`}
          onClick={() => onReact(r.emoji)}
          className={cn(
            chip,
            r.mine
              ? "border-os-accent/30 bg-os-accent/15 text-os-accent"
              : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
      <ReactionPicker palette={palette} onReact={onReact} />
    </div>
  );
}

export function ReactionPicker({
  palette,
  onReact,
  triggerClassName,
}: {
  palette: readonly string[];
  onReact: (emoji: string) => void;
  triggerClassName?: string;
}) {
  return (
    <Popover
      ariaLabel="Add reaction"
      panelClassName="z-[60] w-max p-1.5"
      trigger={
        <IconButton
          label="React"
          icon={SmilePlus}
          className={cn("h-8 w-8 rounded-full", triggerClassName)}
        />
      }
    >
      {(close) => (
        <div className="flex gap-0.5">
          {palette.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact(emoji);
                close();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-os-item text-xl hover:bg-os-container"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
