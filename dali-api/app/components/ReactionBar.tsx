import { SmilePlus } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ReactionSummary } from "~/lib/feedback";
import { Popover } from "~/components/ui/floating";
import { OS_PANEL_CLASS } from "~/components/ui/floating/styles";

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors";

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
            CHIP,
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
    // panelClassName replaces the Popover's surface rather than adding to it,
    // so it has to carry the panel dress itself.
    <Popover
      ariaLabel="Add reaction"
      panelClassName={cn(OS_PANEL_CLASS, "w-max")}
      trigger={
        <button
          type="button"
          aria-label="Add reaction"
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-os-grey transition-colors hover:bg-os-container hover:text-foreground aria-expanded:bg-os-container aria-expanded:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent",
            triggerClassName,
          )}
        >
          <SmilePlus className="h-4 w-4" aria-hidden />
        </button>
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
